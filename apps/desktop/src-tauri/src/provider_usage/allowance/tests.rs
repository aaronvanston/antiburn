use antiburn_local::analysis::{QuotaConfidence, QuotaHitSeverity};

use super::*;

/// 15 Sep 2026, 13:43 in Sydney, as milliseconds.
const REFUSED_AT_MS: i64 = 1_789_443_780_000;

fn incident(ts_ms: i64, limit_kind: QuotaLimitKind) -> QuotaIncident {
    QuotaIncident {
        ts_ms,
        limit_kind,
        severity: QuotaHitSeverity::HardHit,
        model: None,
        reset_ts_ms: None,
        reset_clock: None,
        utilization_pct: None,
        confidence: QuotaConfidence::Observed,
    }
}

fn with_clock(mut incident: QuotaIncident, hour: u8, minute: u8) -> QuotaIncident {
    incident.reset_clock = Some(QuotaResetClock {
        hour,
        minute,
        zone: "Australia/Sydney".to_string(),
    });
    incident
}

#[test]
fn a_stated_clock_later_today_gives_the_wait_to_it() {
    let refused = with_clock(
        incident(REFUSED_AT_MS, QuotaLimitKind::RollingWindow),
        16,
        0,
    );
    let blocks = blocks(&[refused]);
    assert_eq!(blocks.len(), 1);
    // 13:43 to 16:00 is two hours and seventeen minutes.
    assert_eq!(blocks[0].waited_ms(), Some((2 * 60 + 17) * 60 * 1000));
}

#[test]
fn a_clock_that_has_already_passed_states_no_wait() {
    // 9am is behind 13:43, so the next occurrence is tomorrow. A five-hour
    // window cannot hold a 19-hour wait, so the parse is discarded.
    let refused = with_clock(incident(REFUSED_AT_MS, QuotaLimitKind::RollingWindow), 9, 0);
    assert_eq!(blocks(&[refused])[0].waited_ms(), None);
}

#[test]
fn a_weekly_window_holds_a_wait_a_rolling_window_cannot() {
    let refused = with_clock(incident(REFUSED_AT_MS, QuotaLimitKind::Weekly), 9, 0);
    let waited = blocks(&[refused])[0]
        .waited_ms()
        .expect("a weekly wait fits");
    assert_eq!(waited, (19 * 60 + 17) * 60 * 1000);
}

#[test]
fn an_unknown_zone_states_no_wait() {
    let mut refused = incident(REFUSED_AT_MS, QuotaLimitKind::RollingWindow);
    refused.reset_clock = Some(QuotaResetClock {
        hour: 16,
        minute: 0,
        zone: "Nowhere/Invented".to_string(),
    });
    assert_eq!(blocks(&[refused])[0].waited_ms(), None);
}

#[test]
fn a_stated_instant_wins_over_a_stated_clock() {
    let mut refused = with_clock(
        incident(REFUSED_AT_MS, QuotaLimitKind::RollingWindow),
        16,
        0,
    );
    refused.reset_ts_ms = Some(REFUSED_AT_MS + 60 * 60 * 1000);
    assert_eq!(blocks(&[refused])[0].waited_ms(), Some(60 * 60 * 1000));
}

#[test]
fn a_retry_storm_counts_once_and_keeps_the_stated_wait() {
    let first = incident(REFUSED_AT_MS, QuotaLimitKind::RollingWindow);
    let retry = with_clock(
        incident(REFUSED_AT_MS + 90 * 1000, QuotaLimitKind::RollingWindow),
        16,
        0,
    );
    let blocks = blocks(&[retry, first]);
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0].started_at_ms, REFUSED_AT_MS);
    assert_eq!(blocks[0].waited_ms(), Some((2 * 60 + 17) * 60 * 1000));
}

#[test]
fn a_refusal_past_the_storm_gap_is_its_own_block() {
    let first = incident(REFUSED_AT_MS, QuotaLimitKind::RollingWindow);
    let later = incident(
        REFUSED_AT_MS + STORM_GAP_MS + 1_000,
        QuotaLimitKind::RollingWindow,
    );
    assert_eq!(blocks(&[first, later]).len(), 2);
}

#[test]
fn the_overage_counts_blocks_inside_the_span_and_sums_their_waits() {
    let old = incident(
        REFUSED_AT_MS - 40 * 86_400_000,
        QuotaLimitKind::RollingWindow,
    );
    let counted = with_clock(
        incident(REFUSED_AT_MS, QuotaLimitKind::RollingWindow),
        16,
        0,
    );
    let silent = incident(
        REFUSED_AT_MS + STORM_GAP_MS + 1_000,
        QuotaLimitKind::RollingWindow,
    );

    let overage = overage(&[old, counted, silent], REFUSED_AT_MS - 30 * 86_400_000);

    assert_eq!(overage.block_count, 2);
    assert_eq!(overage.waited_ms, (2 * 60 + 17) * 60 * 1000);
    assert_eq!(overage.blocks_without_wait, 1);
    assert_eq!(
        overage.last_block_at_ms,
        Some(REFUSED_AT_MS + STORM_GAP_MS + 1_000)
    );
}

fn rollup(last_observed_epoch: i64, peak_used_percent: Option<f64>) -> ProviderUsagePeriodRollup {
    ProviderUsagePeriodRollup {
        period_id: last_observed_epoch,
        provider: "anthropic".to_string(),
        account_key: "account".to_string(),
        window_kind: "rolling".to_string(),
        window_role: "primaryLong".to_string(),
        scope_key: "account".to_string(),
        starts_at_epoch: Some(last_observed_epoch - 604_800),
        resets_at_epoch: Some(last_observed_epoch),
        first_observed_epoch: last_observed_epoch - 604_800,
        last_observed_epoch,
        peak_used_percent,
        last_used_percent: peak_used_percent,
        observation_count: 1,
        refusal_count: 0,
    }
}

fn weeks(peaks: &[Option<f64>]) -> Vec<ProviderUsagePeriodRollup> {
    peaks
        .iter()
        .enumerate()
        .map(|(index, peak)| rollup(1_800_000_000 + (index as i64) * 604_800, *peak))
        .collect()
}

#[test]
fn a_single_period_states_a_peak_and_no_typical_figure() {
    let utilization = utilization(&weeks(&[Some(62.0)])).expect("one period is enough for a peak");
    assert_eq!(utilization.peak_percent, 62.0);
    assert_eq!(utilization.typical_percent, None);
    assert_eq!(utilization.period_count, 1);
}

#[test]
fn six_periods_state_the_median_as_the_typical_figure() {
    let peaks = [
        Some(18.0),
        Some(40.0),
        Some(44.0),
        Some(50.0),
        Some(60.0),
        Some(62.0),
    ];
    let utilization = utilization(&weeks(&peaks)).expect("six periods reduce");
    assert_eq!(utilization.period_count, 6);
    assert_eq!(utilization.typical_percent, Some(47.0));
    assert_eq!(utilization.peak_percent, 62.0);
    assert_eq!(utilization.maxed_period_count, 0);
}

/// The median and the mean disagree whenever idle periods sit near zero.
/// The median is the one that describes a period the reader recognizes.
#[test]
fn idle_periods_move_the_median_far_less_than_a_mean() {
    let peaks = [
        Some(0.0),
        Some(0.0),
        Some(1.0),
        Some(29.0),
        Some(90.0),
        Some(100.0),
        Some(100.0),
    ];
    let utilization = utilization(&weeks(&peaks)).expect("seven periods reduce");
    assert_eq!(utilization.typical_percent, Some(29.0));
    assert_eq!(utilization.peak_percent, 100.0);
    assert_eq!(utilization.maxed_period_count, 2);
}

#[test]
fn a_period_with_no_reported_figure_is_left_out_and_never_read_as_zero() {
    let utilization =
        utilization(&weeks(&[Some(80.0), None, Some(60.0)])).expect("two periods reduce");
    assert_eq!(utilization.period_count, 2);
    assert_eq!(utilization.peak_percent, 80.0);
}

#[test]
fn periods_with_no_reported_figure_reduce_to_nothing() {
    assert_eq!(utilization(&weeks(&[None, None])), None);
}
