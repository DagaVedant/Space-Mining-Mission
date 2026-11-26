package asteroidbreaker;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

@Configuration
@EnableWebSocket
class Config {

    @Bean
    Settings settings(Environment env) {
        return Settings.from(env);
    }

    @Bean(destroyMethod = "close")
    HikariDataSource dataSource(Settings settings) {
        Settings.DbUrl db = settings.database();
        HikariConfig config = new HikariConfig();
        config.setPoolName("postgres");
        config.setJdbcUrl(db.jdbcUrl());
        config.setUsername(db.user());
        config.setPassword(db.password());
        config.setMaximumPoolSize(5);
        return new HikariDataSource(config);
    }

    /** The ws library in the original capped messages at 4096 bytes; Tomcat closes with 1009 above this. */
    @Bean
    ServletServerContainerFactoryBean webSocketContainer() {
        ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
        container.setMaxTextMessageBufferSize(4096);
        container.setMaxBinaryMessageBufferSize(4096);
        return container;
    }
}
