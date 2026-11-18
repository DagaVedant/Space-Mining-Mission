package com.vulture.mining.api;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.ResponseStatus;

import jakarta.validation.Valid;

import com.vulture.mining.service.RunService;

@RestController
@RequestMapping("/api")
public class RunController {
    private final RunService runService;

    public RunController(RunService runService) {
        this.runService = runService;
    }

    @GetMapping("/daily-crater")
    public RunDtos.DailyCrater dailyCrater() {
        return runService.dailyCrater();
    }

    @GetMapping("/leaderboard")
    public List<RunDtos.LeaderboardEntry> leaderboard(
        @RequestParam(defaultValue = "20") int limit
    ) {
        return runService.leaderboard(limit);
    }

    @PostMapping("/runs")
    @ResponseStatus(HttpStatus.CREATED)
    public RunDtos.SubmissionResult submit(@Valid @RequestBody RunDtos.RunSubmission submission) {
        return runService.submit(submission);
    }
}
