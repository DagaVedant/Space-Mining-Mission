package com.vulture.mining.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.stereotype.Service;

import com.vulture.mining.api.RunDtos;
import com.vulture.mining.model.RunRecord;
import com.vulture.mining.repository.RunRecordRepository;

@Service
public class RunService {
    private static final Set<String> KNOWN_UPGRADES = Set.of(
        "vultureDrillCore",
        "thermalRegulator",
        "reinforcedSuit",
        "cargoModule",
        "empCapacitor",
        "navigationModule",
        "landingThrusters"
    );

    private final RunRecordRepository repository;

    public RunService(RunRecordRepository repository) {
        this.repository = repository;
    }

    public RunDtos.SubmissionResult submit(RunDtos.RunSubmission submission) {
        validateSubmission(submission);

        String upgrades = submission.selectedUpgrades() == null
            ? ""
            : String.join(",", submission.selectedUpgrades());
        RunRecord record = new RunRecord(
            UUID.randomUUID().toString(),
            submission.callsign(),
            submission.seed(),
            submission.durationSeconds(),
            submission.finalSavingsBillions(),
            submission.cargoBillions(),
            submission.shipmentsLaunched(),
            submission.pillsDelivered(),
            submission.peakHeat(),
            submission.finalHealth(),
            submission.completionStatus().name(),
            submission.lossReason().name(),
            upgrades,
            Instant.now()
        );

        RunRecord saved = repository.save(record);
        return new RunDtos.SubmissionResult(saved.getId(), "SUBMITTED");
    }

    public List<RunDtos.LeaderboardEntry> leaderboard(int limit) {
        int safeLimit = Math.max(1, Math.min(limit, 100));
        return repository.findAllByOrderByFinalSavingsBillionsDesc()
            .stream()
            .limit(safeLimit)
            .map(record -> new RunDtos.LeaderboardEntry(
                record.getCallsign(),
                record.getSeed(),
                record.getFinalSavingsBillions(),
                record.getShipmentsLaunched(),
                record.getPillsDelivered(),
                record.getSubmittedAt()
            ))
            .toList();
    }

    public RunDtos.DailyCrater dailyCrater() {
        String date = LocalDate.now(ZoneOffset.UTC).toString();
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(date.getBytes(StandardCharsets.UTF_8));
            long seed = 0;
            for (int i = 0; i < 8; i += 1) {
                seed = (seed << 8) | (digest[i] & 0xffL);
            }
            return new RunDtos.DailyCrater(seed & 0x7fffffffffffffffL, date);
        } catch (Exception exception) {
            throw new IllegalStateException("Unable to generate daily crater", exception);
        }
    }

    private void validateSubmission(RunDtos.RunSubmission submission) {
        if (submission.shipmentsLaunched() < submission.pillsDelivered()) {
            throw new IllegalArgumentException(
                "Medicine deliveries cannot exceed shipments"
            );
        }

        if (submission.completionStatus() == RunDtos.CompletionStatus.VICTORY
            && (submission.finalSavingsBillions() < 1_000_000
            || submission.pillsDelivered() < 1
            || submission.lossReason() != RunDtos.LossReason.NONE)) {
            throw new IllegalArgumentException(
                "Victory requires $1T savings and a medicine delivery"
            );
        }

        if (submission.completionStatus() == RunDtos.CompletionStatus.GAME_OVER
            && submission.lossReason() == RunDtos.LossReason.NONE) {
            throw new IllegalArgumentException(
                "Game-over submission requires a loss reason"
            );
        }

        List<String> upgrades = submission.selectedUpgrades();
        if (upgrades != null) {
            if (upgrades.size() > 7
                || upgrades.stream().anyMatch(upgrade -> !KNOWN_UPGRADES.contains(upgrade))
                || upgrades.stream().distinct().count() != upgrades.size()) {
                throw new IllegalArgumentException(
                    "Selected upgrades are unknown or stacked beyond the release rule"
                );
            }
        }
    }
}
