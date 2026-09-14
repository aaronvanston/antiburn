//! Persist HUD preferences and serialize dynamic presentation requests.

use std::time::{Duration, Instant};

use antiburn_hud::Edge;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, oneshot};

use crate::analytics::event::Origin;
use crate::store::Store;

const KEY: &str = "internal:dynamicHud";
const SETTINGS_EVENT: &str = "hud:settings";
const MOTION_EVENT: &str = "hud:motion";
const SLIDE: Duration = Duration::from_millis(300);
const DWELL: Duration = Duration::from_millis(300);

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub enabled: bool,
    pub dynamic: bool,
    pub edge: Edge,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Change {
    pub enabled: Option<bool>,
    pub dynamic: Option<bool>,
    pub edge: Option<Edge>,
}

type Reply = oneshot::Sender<Result<Preferences, String>>;
enum Request {
    Read(bool, Reply),
    Change(Change, Reply),
    Reveal(Origin, Reply),
    Drag(bool, Reply),
    Activity(i64),
    ResetActivity,
}

pub struct Controller(mpsc::Sender<Request>);

impl Controller {
    async fn request(&self, make: impl FnOnce(Reply) -> Request) -> Result<Preferences, String> {
        let (tx, rx) = oneshot::channel();
        self.0
            .send(make(tx))
            .await
            .map_err(|error| error.to_string())?;
        rx.await.map_err(|error| error.to_string())?
    }
}

pub async fn read(app: &AppHandle, legacy: bool) -> Result<Preferences, String> {
    app.state::<Controller>()
        .request(|reply| Request::Read(legacy, reply))
        .await
}

pub async fn change(app: &AppHandle, change: Change) -> Result<Preferences, String> {
    app.state::<Controller>()
        .request(|reply| Request::Change(change, reply))
        .await
}

pub async fn reveal(app: &AppHandle, origin: Origin) -> Result<Preferences, String> {
    app.state::<Controller>()
        .request(|reply| Request::Reveal(origin, reply))
        .await
}

pub async fn drag(app: &AppHandle, active: bool) -> Result<Preferences, String> {
    app.state::<Controller>()
        .request(|reply| Request::Drag(active, reply))
        .await
}

/// Receive semantic time after the scanner applies source and repository gates.
pub fn observe_records(app: &AppHandle, records: &[crate::store::SessionRecord]) {
    let now = epoch_now();
    let latest = records
        .iter()
        .filter(|record| {
            record.activity_source == "event"
                && matches!(record.key.agent.as_str(), "claude-code" | "codex")
        })
        .filter_map(|record| record.updated_at_epoch)
        .filter(|epoch| *epoch <= now + 5)
        .max();
    if let (Some(controller), Some(epoch)) = (app.try_state::<Controller>(), latest) {
        let _ = controller.0.try_send(Request::Activity(epoch));
    }
}

pub fn reset_activity(app: &AppHandle) {
    if let Some(controller) = app.try_state::<Controller>() {
        let _ = controller.0.try_send(Request::ResetActivity);
    }
}

#[derive(Default)]
struct Presentation {
    subsequent: bool,
    waiting: bool,
    deadline: Option<Instant>,
    concealing: Option<Instant>,
    edge_since: Option<(String, Instant)>,
    edge_used: bool,
}

#[derive(Debug, PartialEq)]
enum Action {
    Reveal,
    Conceal,
    Hide,
    Restore,
}

impl Presentation {
    fn duration(&self) -> Duration {
        Duration::from_secs(if self.subsequent { 3 } else { 5 })
    }

    fn reveal(&mut self) {
        self.waiting = true;
        self.deadline = None;
        self.concealing = None;
    }

    fn resume(&mut self, now: Instant, visible: bool, edge: Option<&String>) {
        self.edge_since = edge.map(|edge| (edge.clone(), now));
        self.edge_used = edge.is_some();
        if visible {
            self.reveal();
        }
    }

    fn tick(
        &mut self,
        now: Instant,
        visible: bool,
        held: bool,
        edge: Option<String>,
    ) -> Option<Action> {
        if let Some(edge) = edge {
            if self
                .edge_since
                .as_ref()
                .is_none_or(|(previous, _)| *previous != edge)
            {
                self.edge_since = Some((edge, now));
                self.edge_used = false;
            }
            if !self.edge_used
                && self
                    .edge_since
                    .as_ref()
                    .is_some_and(|(_, since)| now.duration_since(*since) >= DWELL)
            {
                self.edge_used = true;
                self.reveal();
                return Some(Action::Reveal);
            }
        } else {
            self.edge_since = None;
            self.edge_used = false;
        }
        if !visible {
            return None;
        }
        if self.waiting || held {
            self.waiting = false;
            self.deadline = Some(now + self.duration());
            if self.concealing.take().is_some() {
                return Some(Action::Restore);
            }
        }
        if self.concealing.is_some_and(|deadline| now >= deadline) {
            self.concealing = None;
            self.deadline = None;
            self.subsequent = true;
            return Some(Action::Hide);
        }
        if self.concealing.is_none() && self.deadline.is_some_and(|deadline| now >= deadline) {
            self.concealing = Some(now + SLIDE);
            return Some(Action::Conceal);
        }
        None
    }
}

struct ReturnDetector {
    last: i64,
    clock: i64,
}
impl ReturnDetector {
    fn new(now: i64) -> Self {
        Self {
            last: now,
            clock: now,
        }
    }
    fn observe(&mut self, epoch: i64, now: i64) -> bool {
        if now < self.clock {
            *self = Self::new(now);
            return false;
        }
        self.clock = now;
        if epoch <= self.last || epoch > now + 5 || epoch < now - 30 {
            return false;
        }
        let returned = epoch - self.last >= 3600;
        self.last = epoch;
        returned
    }
}

fn poll_interrupted(previous_wall: i64, wall: i64, elapsed: Duration) -> bool {
    wall < previous_wall
        || wall.saturating_sub(previous_wall) > 2
        || elapsed > Duration::from_secs(2)
}

fn epoch_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs() as i64)
}

fn save(app: &AppHandle, preferences: Preferences) -> Result<(), String> {
    let raw = serde_json::to_string(&preferences).map_err(|error| error.to_string())?;
    app.state::<Store>()
        .set_internal_value_checked(KEY, &raw)
        .map_err(|error| error.to_string())?;
    let _ = app.emit(SETTINGS_EVENT, preferences);
    Ok(())
}

fn motion(app: &AppHandle, preferences: Preferences, concealing: bool) {
    let _ = app.emit(
        MOTION_EVENT,
        serde_json::json!({
            "dynamic": preferences.dynamic, "edge": preferences.edge, "concealing": concealing,
        }),
    );
}

fn show(
    app: &AppHandle,
    preferences: Preferences,
    origin: Origin,
    state: &mut Presentation,
) -> Result<(), String> {
    if antiburn_hud::is_dragging() {
        state.reveal();
        return Ok(());
    }
    antiburn_hud::set_dynamic_edge(preferences.dynamic.then_some(preferences.edge));
    motion(app, preferences, false);
    #[cfg(target_os = "macos")]
    if app
        .get_webview_window(antiburn_hud::OVERLAY_LABEL)
        .is_none_or(|window| !window.is_visible().unwrap_or(false))
    {
        crate::analytics::prepare_hud_exposure(origin);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = origin;
    let entries = crate::hud::load_placements(&app.state::<Store>());
    antiburn_hud::open(app, &entries).map_err(|error| {
        crate::analytics::cancel_hud_exposure();
        error.to_string()
    })?;
    state.reveal();
    Ok(())
}

/// Own one bounded command queue for the lifetime of the app.
pub fn spawn(app: &AppHandle) -> tauri::async_runtime::JoinHandle<()> {
    let (tx, mut rx) = mpsc::channel(32);
    app.manage(Controller(tx));
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let stored = app
            .state::<Store>()
            .internal_value(KEY)
            .and_then(|raw| serde_json::from_str::<Preferences>(&raw).ok());
        let mut migrated = stored.is_some();
        let mut preferences = stored.unwrap_or_default();
        let mut presentation = Presentation::default();
        let mut detector = ReturnDetector::new(epoch_now());
        let mut last_poll = Instant::now();
        let mut last_wall = epoch_now();
        if preferences.enabled
            && let Err(error) = show(&app, preferences, Origin::Automatic, &mut presentation)
        {
            tracing::warn!(event = "hud_reveal_failed", %error);
        }
        loop {
            let request = if preferences.enabled && preferences.dynamic {
                tokio::select! {
                    request = rx.recv() => request,
                    () = tokio::time::sleep(Duration::from_millis(100)) => {
                        let sample = antiburn_hud::dynamic_sample(&app, preferences.edge);
                        let now = Instant::now();
                        let wall = epoch_now();
                        if poll_interrupted(last_wall, wall, now.duration_since(last_poll)) {
                            presentation.resume(now, sample.visible, sample.edge.as_ref());
                            if sample.visible { motion(&app, preferences, false); }
                        }
                        last_poll = now;
                        last_wall = wall;
                        let action = presentation.tick(now, sample.visible, sample.hovered || antiburn_hud::is_dragging(), if antiburn_hud::is_dragging() { None } else { sample.edge });
                        match action {
                            Some(Action::Reveal) => {
                                if let Err(error) = show(&app, preferences, Origin::User, &mut presentation) {
                                    tracing::warn!(event = "hud_reveal_failed", %error);
                                }
                            }
                            Some(Action::Conceal) => {
                                antiburn_hud::hide_detail(&app);
                                motion(&app, preferences, true);
                            }
                            Some(Action::Restore) => motion(&app, preferences, false),
                            Some(Action::Hide) => {
                                if let Err(error) = antiburn_hud::hide(&app) {
                                    tracing::warn!(event = "hud_conceal_failed", %error);
                                    presentation.reveal();
                                    motion(&app, preferences, false);
                                }
                            }
                            None => {}
                        }
                        continue;
                    }
                }
            } else {
                rx.recv().await
            };
            let Some(request) = request else {
                break;
            };
            match request {
                Request::Read(legacy, reply) => {
                    let result = if !migrated {
                        preferences.enabled = legacy;
                        save(&app, preferences).and_then(|()| {
                            migrated = true;
                            if legacy {
                                show(&app, preferences, Origin::Automatic, &mut presentation)?;
                            }
                            Ok(preferences)
                        })
                    } else {
                        Ok(preferences)
                    };
                    let _ = reply.send(result);
                }
                Request::Change(change, reply) => {
                    let next = Preferences {
                        enabled: change.enabled.unwrap_or(preferences.enabled),
                        dynamic: change.dynamic.unwrap_or(preferences.dynamic),
                        edge: change.edge.unwrap_or(preferences.edge),
                    };
                    let result = save(&app, next).and_then(|()| {
                        migrated = true;
                        if !preferences.enabled && next.enabled {
                            presentation = Presentation::default();
                        }
                        if preferences.enabled != next.enabled
                            || preferences.dynamic != next.dynamic
                        {
                            detector = ReturnDetector::new(epoch_now());
                        }
                        let changed = preferences != next;
                        preferences = next;
                        antiburn_hud::set_dynamic_edge(next.dynamic.then_some(next.edge));
                        if !next.enabled {
                            antiburn_hud::set_dragging(false);
                            presentation = Presentation::default();
                            antiburn_hud::hide(&app).map_err(|error| error.to_string())?;
                        } else if changed {
                            show(&app, next, Origin::User, &mut presentation)?;
                        }
                        Ok(next)
                    });
                    let _ = reply.send(result);
                }
                Request::Reveal(origin, reply) => {
                    let result = if preferences.enabled {
                        show(&app, preferences, origin, &mut presentation).map(|()| preferences)
                    } else {
                        Ok(preferences)
                    };
                    let _ = reply.send(result);
                }
                Request::Drag(active, reply) => {
                    antiburn_hud::set_dragging(active && preferences.enabled);
                    presentation.reveal();
                    motion(&app, preferences, false);
                    let result = if active || !preferences.enabled {
                        Ok(preferences)
                    } else {
                        let entries = crate::hud::load_placements(&app.state::<Store>());
                        antiburn_hud::apply_placement(&app, &entries)
                            .map(|()| preferences)
                            .map_err(|error| error.to_string())
                    };
                    let _ = reply.send(result);
                }
                Request::Activity(epoch) => {
                    let can_observe = preferences.enabled
                        && preferences.dynamic
                        && app.state::<Store>().settings().is_ok_and(|settings| {
                            settings.onboarding_completed && !settings.discovery_paused
                        });
                    if can_observe
                        && detector.observe(epoch, epoch_now())
                        && let Err(error) =
                            show(&app, preferences, Origin::Automatic, &mut presentation)
                    {
                        tracing::warn!(event = "hud_reveal_failed", %error);
                    }
                }
                Request::ResetActivity => detector = ReturnDetector::new(epoch_now()),
            }
        }
    })
}

#[cfg(test)]
mod tests;
