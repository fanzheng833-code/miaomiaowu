package handler

import (
	"slices"
	"testing"
	"time"

	"miaomiaowu/internal/storage"
)

func TestTrafficHistoryDailyDeltas(t *testing.T) {
	today := time.Date(2026, time.November, 26, 0, 0, 0, 0, time.UTC)
	now := time.Date(2026, time.November, 27, 4, 0, 0, 0, time.FixedZone("UTC+8", 8*60*60))

	type snapshot struct {
		dayOffset int
		totalGB   int64
	}
	tests := []struct {
		name      string
		days      int
		snapshots []snapshot
		want      []trafficDailyUsage
	}{
		{
			name: "first point uses the snapshot before the selected window",
			days: 3,
			snapshots: []snapshot{
				{-4, 850},
				{-3, 900},
				{-2, 915},
				{-1, 930},
				{-2, 920},
				{0, 947},
			},
			want: []trafficDailyUsage{
				{Date: "2026-11-24", UsedGB: 20},
				{Date: "2026-11-25", UsedGB: 10},
				{Date: "2026-11-26", UsedGB: 17},
			},
		},
		{
			name: "gaps and stale snapshots do not extend the calendar window",
			days: 7,
			snapshots: []snapshot{
				{-12, 50},
				{-11, 52},
				{-7, 70},
				{-6, 73},
				{-4, 80},
				{-3, 81},
			},
			want: []trafficDailyUsage{
				{Date: "2026-11-20", UsedGB: 3},
				{Date: "2026-11-23", UsedGB: 1},
			},
		},
		{
			name: "decreasing counter stays clamped to zero",
			days: 3,
			snapshots: []snapshot{
				{-2, 101},
				{-1, 4},
				{0, 9},
			},
			want: []trafficDailyUsage{
				{Date: "2026-11-25", UsedGB: 0},
				{Date: "2026-11-26", UsedGB: 5},
			},
		},
		{
			name:      "single snapshot has no daily delta",
			days:      30,
			snapshots: []snapshot{{0, 123}},
		},
		{
			name: "empty history",
			days: 30,
		},
		{
			name:      "future UTC snapshots do not displace the baseline",
			days:      3,
			snapshots: []snapshot{{-3, 7}, {-2, 11}, {-1, 12}, {0, 15}, {1, 17}, {2, 21}},
			want: []trafficDailyUsage{
				{Date: "2026-11-24", UsedGB: 4},
				{Date: "2026-11-25", UsedGB: 1},
				{Date: "2026-11-26", UsedGB: 3},
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			repo, err := storage.NewTrafficRepository(":memory:")
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if err := repo.Close(); err != nil {
					t.Error(err)
				}
			})

			ctx := t.Context()
			const limit = 1024 * int64(bytesPerGigabyte)
			for _, snapshot := range tc.snapshots {
				date := today.AddDate(0, 0, snapshot.dayOffset)
				used := snapshot.totalGB * int64(bytesPerGigabyte)
				if err := repo.RecordDaily(ctx, date, limit, used, limit-used); err != nil {
					t.Fatal(err)
				}
			}

			handler := NewTrafficSummaryHandler(repo)
			got, err := handler.loadHistory(ctx, now, tc.days)
			if err != nil {
				t.Fatal(err)
			}
			if !slices.Equal(got, tc.want) {
				t.Fatalf("loadHistory = %+v, want %+v", got, tc.want)
			}
		})
	}
}
