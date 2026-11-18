package com.vulture.mining.api;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class RunControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void dailyCraterAndLeaderboardAreAvailable() throws Exception {
        mockMvc.perform(get("/api/daily-crater"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.seed").exists())
            .andExpect(jsonPath("$.date").exists());

        mockMvc.perform(get("/api/leaderboard?limit=20"))
            .andExpect(status().isOk());
    }

    @Test
    void acceptsAValidRunSubmission() throws Exception {
        String body = """
            {
              "callsign": "ALPHA-01",
              "seed": 12345,
              "durationSeconds": 1800,
              "finalSavingsBillions": 1000000,
              "cargoBillions": 0,
              "shipmentsLaunched": 1,
              "pillsDelivered": 1,
              "peakHeat": 100,
              "finalHealth": 80,
              "completionStatus": "VICTORY",
              "lossReason": "NONE",
              "selectedUpgrades": ["vultureDrillCore"]
            }
            """;

        mockMvc.perform(post("/api/runs")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.status").value("SUBMITTED"))
            .andExpect(jsonPath("$.id").exists());
    }

    @Test
    void rejectsImpossibleVictory() throws Exception {
        String body = """
            {
              "callsign": "ALPHA-01",
              "seed": 12345,
              "durationSeconds": 1800,
              "finalSavingsBillions": 10,
              "cargoBillions": 0,
              "shipmentsLaunched": 0,
              "pillsDelivered": 0,
              "peakHeat": 100,
              "finalHealth": 80,
              "completionStatus": "VICTORY",
              "lossReason": "NONE",
              "selectedUpgrades": []
            }
            """;

        mockMvc.perform(post("/api/runs")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.title").value("Invalid run summary"));
    }
}
