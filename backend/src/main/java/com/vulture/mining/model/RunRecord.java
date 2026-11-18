package com.vulture.mining.model;

import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "run_records")
public class RunRecord {

    @Id
    @Column(length = 36)
    private String id;

    @Column(nullable = false, length = 32)
    private String callsign;

    @Column(nullable = false)
    private long seed;

    @Column(nullable = false)
    private int durationSeconds;

    @Column(nullable = false)
    private long finalSavingsBillions;

    @Column(nullable = false)
    private long cargoBillions;

    @Column(nullable = false)
    private int shipmentsLaunched;

    @Column(nullable = false)
    private int pillsDelivered;

    @Column(nullable = false)
    private int peakHeat;

    @Column(nullable = false)
    private int finalHealth;

    @Column(nullable = false, length = 16)
    private String completionStatus;

    @Column(nullable = false, length = 16)
    private String lossReason;

    @Column(length = 1024)
    private String selectedUpgrades;

    @Column(nullable = false)
    private Instant submittedAt;

    protected RunRecord() {}

    public RunRecord(
        String id,
        String callsign,
        long seed,
        int durationSeconds,
        long finalSavingsBillions,
        long cargoBillions,
        int shipmentsLaunched,
        int pillsDelivered,
        int peakHeat,
        int finalHealth,
        String completionStatus,
        String lossReason,
        String selectedUpgrades,
        Instant submittedAt
    ) {
        this.id = id;
        this.callsign = callsign;
        this.seed = seed;
        this.durationSeconds = durationSeconds;
        this.finalSavingsBillions = finalSavingsBillions;
        this.cargoBillions = cargoBillions;
        this.shipmentsLaunched = shipmentsLaunched;
        this.pillsDelivered = pillsDelivered;
        this.peakHeat = peakHeat;
        this.finalHealth = finalHealth;
        this.completionStatus = completionStatus;
        this.lossReason = lossReason;
        this.selectedUpgrades = selectedUpgrades;
        this.submittedAt = submittedAt;
    }

    public String getId() { return id; }
    public String getCallsign() { return callsign; }
    public long getSeed() { return seed; }
    public int getDurationSeconds() { return durationSeconds; }
    public long getFinalSavingsBillions() { return finalSavingsBillions; }
    public long getCargoBillions() { return cargoBillions; }
    public int getShipmentsLaunched() { return shipmentsLaunched; }
    public int getPillsDelivered() { return pillsDelivered; }
    public int getPeakHeat() { return peakHeat; }
    public int getFinalHealth() { return finalHealth; }
    public String getCompletionStatus() { return completionStatus; }
    public String getLossReason() { return lossReason; }
    public String getSelectedUpgrades() { return selectedUpgrades; }
    public Instant getSubmittedAt() { return submittedAt; }
}
