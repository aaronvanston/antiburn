use super::*;

#[test]
fn first_countdown_starts_at_visibility_then_later_reveals_last_three_seconds() {
    let start = Instant::now();
    let mut state = Presentation::default();
    state.reveal();
    assert_eq!(
        state.tick(start + Duration::from_secs(10), false, false, None),
        None
    );
    let shown = start + Duration::from_secs(11);
    assert_eq!(state.tick(shown, true, false, None), None);
    assert_eq!(
        state.tick(shown + Duration::from_secs(4), true, false, None),
        None
    );
    assert_eq!(
        state.tick(shown + Duration::from_secs(5), true, false, None),
        Some(Action::Conceal)
    );
    assert_eq!(
        state.tick(shown + Duration::from_secs(5) + SLIDE, true, false, None),
        Some(Action::Hide)
    );
    state.reveal();
    let shown = shown + Duration::from_secs(20);
    state.tick(shown, true, false, None);
    assert_eq!(
        state.tick(shown + Duration::from_secs(3), true, false, None),
        Some(Action::Conceal)
    );
}

#[test]
fn hover_restarts_the_countdown_and_cancels_a_slide() {
    let now = Instant::now();
    let mut state = Presentation::default();
    state.reveal();
    state.tick(now, true, false, None);
    state.tick(now + Duration::from_secs(4), true, true, None);
    assert_eq!(
        state.tick(now + Duration::from_secs(8), true, false, None),
        None
    );
    assert_eq!(
        state.tick(now + Duration::from_secs(9), true, false, None),
        Some(Action::Conceal)
    );
    assert_eq!(
        state.tick(now + Duration::from_millis(9100), true, true, None),
        Some(Action::Restore)
    );
    assert!(!state.subsequent);
    assert_eq!(
        state.tick(now + Duration::from_secs(14), true, false, None),
        None
    );
}

#[test]
fn edge_requires_dwell_and_leaving_before_it_can_fire_again() {
    let now = Instant::now();
    let mut state = Presentation::default();
    assert_eq!(
        state.tick(now, false, false, Some("monitor-a".into())),
        None
    );
    assert_eq!(
        state.tick(now + DWELL, false, false, Some("monitor-a".into())),
        Some(Action::Reveal)
    );
    assert_eq!(
        state.tick(
            now + Duration::from_secs(30),
            false,
            false,
            Some("monitor-a".into())
        ),
        None
    );
    state.tick(now + Duration::from_secs(31), false, false, None);
    assert_eq!(
        state.tick(
            now + Duration::from_secs(32),
            false,
            false,
            Some("monitor-a".into())
        ),
        None
    );
    assert_eq!(
        state.tick(
            now + Duration::from_secs(33),
            false,
            false,
            Some("monitor-b".into())
        ),
        None
    );
    assert_eq!(
        state.tick(
            now + Duration::from_secs(33) + DWELL,
            false,
            false,
            Some("monitor-b".into())
        ),
        Some(Action::Reveal)
    );
}

#[test]
fn replay_duplicates_future_events_and_clock_changes_do_not_show() {
    let mut detector = ReturnDetector::new(10_000);
    assert!(!detector.observe(9_999, 14_000));
    assert!(!detector.observe(10_000, 14_000));
    assert!(!detector.observe(13_000, 14_000));
    assert!(!detector.observe(15_000, 14_000));
    assert!(detector.observe(14_000, 14_000));
    assert!(!detector.observe(14_000, 14_001));
    assert!(!detector.observe(14_002, 14_002));
    assert!(!detector.observe(10_100, 10_100));
}

#[test]
fn continuous_work_prevents_rearming_and_sleep_needs_a_fresh_event() {
    let mut detector = ReturnDetector::new(10_000);
    assert!(!detector.observe(13_599, 13_599));
    assert!(!detector.observe(17_000, 17_000));
    assert!(detector.observe(20_600, 20_600));
    assert!(!detector.observe(20_600, 30_000));
    assert!(detector.observe(30_000, 30_000));
}

#[test]
fn preferences_default_to_persistent_and_reject_unknown_edges() {
    assert_eq!(
        Preferences::default(),
        Preferences {
            enabled: false,
            dynamic: false,
            edge: Edge::Top
        }
    );
    assert!(serde_json::from_str::<Change>(r#"{"edge":"diagonal"}"#).is_err());
    let preferences = Preferences {
        enabled: true,
        dynamic: true,
        edge: Edge::Right,
    };
    let raw = serde_json::to_string(&preferences).unwrap();
    assert_eq!(
        serde_json::from_str::<Preferences>(&raw).unwrap(),
        preferences
    );
}

#[test]
fn wake_does_not_retrieve_a_hidden_hud_from_a_stationary_edge_pointer() {
    let now = Instant::now();
    let mut state = Presentation::default();
    let edge = "display".to_string();
    state.tick(now, false, false, Some(edge.clone()));
    state.resume(now + Duration::from_secs(3600), false, Some(&edge));
    assert_eq!(
        state.tick(now + Duration::from_secs(3601), false, false, Some(edge)),
        None
    );
    assert!(poll_interrupted(1000, 4600, Duration::from_millis(100)));
    assert!(poll_interrupted(1000, 999, Duration::from_millis(100)));
    assert!(!poll_interrupted(1000, 1001, Duration::from_millis(100)));
}

#[test]
fn a_long_drag_holds_both_countdowns_then_release_gets_the_full_duration() {
    for subsequent in [false, true] {
        let now = Instant::now();
        let mut state = Presentation {
            subsequent,
            ..Default::default()
        };
        state.reveal();
        state.tick(now, true, false, None);
        for second in 1..=30 {
            assert_eq!(
                state.tick(now + Duration::from_secs(second), true, true, None),
                None
            );
        }
        let released = now + Duration::from_secs(31);
        state.reveal();
        state.tick(released, true, false, None);
        assert_eq!(
            state.tick(
                released + state.duration() - Duration::from_millis(1),
                true,
                false,
                None
            ),
            None
        );
        assert_eq!(
            state.tick(released + state.duration(), true, false, None),
            Some(Action::Conceal)
        );
    }
}
