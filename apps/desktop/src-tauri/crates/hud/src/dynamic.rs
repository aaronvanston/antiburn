//! Edge placement and pointer sampling for the dynamic HUD.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};

static DRAGGING: AtomicBool = AtomicBool::new(false);

pub fn set_dragging(active: bool) {
    DRAGGING.store(active, Ordering::Relaxed);
}

pub fn is_dragging() -> bool {
    DRAGGING.load(Ordering::Relaxed)
}

#[cfg(target_os = "macos")]
static CUSTOM_POSITION: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "macos")]
pub(super) fn set_custom_position(saved: bool) {
    CUSTOM_POSITION.store(saved, Ordering::Relaxed);
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Edge {
    #[default]
    Top,
    Left,
    Right,
    Bottom,
}

#[derive(Default)]
pub struct DynamicSample {
    pub visible: bool,
    pub hovered: bool,
    pub edge: Option<String>,
}

#[cfg(target_os = "macos")]
static EDGE: std::sync::Mutex<Option<Edge>> = std::sync::Mutex::new(None);

pub fn set_dynamic_edge(edge: Option<Edge>) {
    #[cfg(target_os = "macos")]
    {
        *EDGE.lock().unwrap_or_else(|error| error.into_inner()) = edge;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = edge;
    }
}

#[cfg(target_os = "macos")]
pub(super) fn place(
    window: &tauri::WebviewWindow,
    follow_pointer: bool,
) -> Option<tauri::Result<()>> {
    use tauri::PhysicalPosition;
    if is_dragging() || CUSTOM_POSITION.load(Ordering::Relaxed) {
        return None;
    }
    let edge = (*EDGE.lock().unwrap_or_else(|error| error.into_inner()))?;
    let monitor = follow_pointer
        .then(|| {
            let cursor = window.cursor_position().ok()?;
            window
                .available_monitors()
                .ok()?
                .into_iter()
                .find(|monitor| {
                    let pos = monitor.position();
                    let size = monitor.size();
                    super::contains_point(
                        pos.x as f64,
                        pos.y as f64,
                        size.width as f64,
                        size.height as f64,
                        cursor.x,
                        cursor.y,
                    )
                })
        })
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten())?;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let (x, y) = position(
        edge,
        area.size.width as f64 / scale,
        area.size.height as f64 / scale,
        super::OVERLAY_WIDTH,
        super::RESIZE_STATE.height(),
    );
    Some(window.set_position(PhysicalPosition::new(
        area.position.x as f64 + x * scale,
        area.position.y as f64 + y * scale,
    )))
}

#[cfg(any(target_os = "macos", test))]
fn position(edge: Edge, width: f64, height: f64, hud_width: f64, hud_height: f64) -> (f64, f64) {
    let max_x = (width - hud_width).max(0.0);
    let max_y = (height - hud_height).max(0.0);
    match edge {
        Edge::Top => (max_x / 2.0, 0.0),
        Edge::Bottom => (max_x / 2.0, max_y),
        Edge::Left => (0.0, max_y / 2.0),
        Edge::Right => (max_x, max_y / 2.0),
    }
}

#[cfg(any(target_os = "macos", test))]
fn at_edge(edge: Edge, x: f64, y: f64, width: f64, height: f64) -> bool {
    match edge {
        Edge::Top | Edge::Bottom if x >= 24.0 && x < width - 24.0 => {
            if edge == Edge::Top {
                (0.0..2.0).contains(&y)
            } else {
                y >= height - 2.0 && y < height
            }
        }
        Edge::Left | Edge::Right if y >= 24.0 && y < height - 24.0 => {
            if edge == Edge::Left {
                (0.0..2.0).contains(&x)
            } else {
                x >= width - 2.0 && x < width
            }
        }
        _ => false,
    }
}

#[cfg(target_os = "macos")]
pub fn dynamic_sample(app: &tauri::AppHandle, edge: Edge) -> DynamicSample {
    use tauri::Manager;
    let Some(window) = app.get_webview_window(super::OVERLAY_LABEL) else {
        return DynamicSample::default();
    };
    let visible = window.is_visible().unwrap_or(false);
    let mut sample = DynamicSample {
        visible,
        hovered: visible && super::cursor_inside(&window).unwrap_or(false),
        edge: None,
    };
    let Ok(cursor) = window.cursor_position() else {
        return sample;
    };
    let Ok(monitors) = window.available_monitors() else {
        return sample;
    };
    for monitor in &monitors {
        let pos = monitor.position();
        let size = monitor.size();
        let scale = monitor.scale_factor();
        if !at_edge(
            edge,
            (cursor.x - pos.x as f64) / scale,
            (cursor.y - pos.y as f64) / scale,
            size.width as f64 / scale,
            size.height as f64 / scale,
        ) {
            continue;
        }
        let outside = match edge {
            Edge::Top => (cursor.x, pos.y as f64 - 1.0),
            Edge::Bottom => (cursor.x, pos.y as f64 + size.height as f64),
            Edge::Left => (pos.x as f64 - 1.0, cursor.y),
            Edge::Right => (pos.x as f64 + size.width as f64, cursor.y),
        };
        let shared = monitors.iter().any(|other| {
            let origin = other.position();
            let size = other.size();
            super::contains_point(
                origin.x as f64,
                origin.y as f64,
                size.width as f64,
                size.height as f64,
                outside.0,
                outside.1,
            )
        });
        if !shared {
            sample.edge = Some(format!(
                "{}|{},{}",
                super::monitor_key(monitor),
                pos.x,
                pos.y
            ));
        }
        break;
    }
    sample
}

#[cfg(not(target_os = "macos"))]
pub fn dynamic_sample(_app: &tauri::AppHandle, _edge: Edge) -> DynamicSample {
    DynamicSample::default()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn each_edge_anchors_the_content_frame() {
        assert_eq!(
            position(Edge::Top, 1000.0, 800.0, 176.0, 60.0),
            (412.0, 0.0)
        );
        assert_eq!(
            position(Edge::Bottom, 1000.0, 800.0, 176.0, 60.0),
            (412.0, 740.0)
        );
        assert_eq!(
            position(Edge::Left, 1000.0, 800.0, 176.0, 60.0),
            (0.0, 370.0)
        );
        assert_eq!(
            position(Edge::Right, 1000.0, 800.0, 176.0, 60.0),
            (824.0, 370.0)
        );
        assert_eq!(position(Edge::Bottom, 100.0, 30.0, 176.0, 60.0), (0.0, 0.0));
    }
    #[test]
    fn edge_zone_excludes_corners_and_other_displays() {
        assert!(at_edge(Edge::Top, 500.0, 1.0, 1000.0, 800.0));
        assert!(!at_edge(Edge::Top, 10.0, 1.0, 1000.0, 800.0));
        assert!(!at_edge(Edge::Top, 500.0, -1.0, 1000.0, 800.0));
        assert!(at_edge(Edge::Right, 999.0, 400.0, 1000.0, 800.0));
        assert!(!at_edge(Edge::Right, 1001.0, 400.0, 1000.0, 800.0));
    }
}
