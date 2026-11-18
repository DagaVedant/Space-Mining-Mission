package com.vulture.mining.api;

import java.time.Instant;
import java.util.List;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public final class RunDtos {
    private RunDtos() {}

    public record RunSubmission(
        @NotBlank @Pattern(regexp = "^[A-Z0-9]{1,16}-[A-Z0-9]{1,16}$")
        String callsign,
        @Min(0) @Max(4_294_967_295L)
        long seed,
        @Min(0) @Max(31_536_000)
        int durationSeconds,
        @Min(0) @Max(1_000_000_000L)
        long finalSavingsBillions,
        @Min(0) @Max(10_000)
        long cargoBillions,
        @Min(0) @Max(1000)
        int shipmentsLaunched,
        @Min(0) @Max(1000)
        int pillsDelivered,
        @Min(0) @Max(100)
        int peakHeat,
        @Min(0) @Max(150)
        int finalHealth,
        @NotNull
        CompletionStatus completionStatus,
        @NotNull
        LossReason lossReason,
        @Size(max = 7)
        List<String> selectedUpgrades
    ) {}

    public enum CompletionStatus {
        VICTORY,
        GAME_OVER
    }

    public enum LossReason {
        NONE,
        HULL,
        CANNON
    }

    public record LeaderboardEntry(
        String callsign,
        long seed,
        long savingsBillions,
        int shipmentsLaunched,
        int pillsDelivered,
        Instant submittedAt
    ) {}

    public record DailyCrater(
        long seed,
        String date
    ) {}

    public record SubmissionResult(
        String id,
        String status
    ) {}
}
