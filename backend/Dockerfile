FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY pom.xml .
RUN mvn -B -q dependency:go-offline
COPY src ./src
RUN mvn -B -q -DskipTests package

FROM eclipse-temurin:21-jre
RUN groupadd --system app && useradd --system --gid app app
WORKDIR /app
COPY --from=build /build/target/backend.jar backend.jar
USER app

# Sized for a 512 MB instance: about 280 MB of heap, the rest for metaspace, code cache,
# thread stacks and the 16 MB each concurrent password hash needs.
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=55 -XX:+UseSerialGC -XX:MaxMetaspaceSize=128m -XX:ReservedCodeCacheSize=64m -Xss512k -XX:+ExitOnOutOfMemoryError"
ENV PORT=3001
EXPOSE 3001
ENTRYPOINT ["java", "-jar", "backend.jar"]
