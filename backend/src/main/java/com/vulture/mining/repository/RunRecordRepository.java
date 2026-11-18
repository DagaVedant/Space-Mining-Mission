package com.vulture.mining.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

import com.vulture.mining.model.RunRecord;

public interface RunRecordRepository extends JpaRepository<RunRecord, String> {
    List<RunRecord> findAllByOrderByFinalSavingsBillionsDesc();
}
