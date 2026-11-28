# Stage 1: Build the application
FROM maven:3.8.5-openjdk-17-slim AS build
WORKDIR /build

# Declare the build arguments
ARG GITHUB_TOKEN
ARG ACCESS_GITHUB_USERNAME
ARG JAVA_TOKEN
ARG SENTRY_AUTH_TOKEN

# Set environment variables - SENTRY_AUTH_TOKEN must be available for Maven
ENV JAVA_TOKEN=$JAVA_TOKEN
ENV ACCESS_GITHUB_USERNAME=$ACCESS_GITHUB_USERNAME
ENV SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN

# Copy the Maven settings file
COPY settings.xml ./

# Copy the project files
COPY . .

# Build with SENTRY_AUTH_TOKEN passed as Maven property
RUN mvn -s settings.xml clean package -DskipTests -Dsentry.authToken=$SENTRY_AUTH_TOKEN


# Stage 2: Package the application into the final image
FROM amazoncorretto:17-alpine
# Fonts + fontconfig for java.awt: Batik draws the text of the progress-report PDF's SVG charts
# through java.awt.Font, which fails on bare Alpine with "Fontconfig head is null".
RUN apk add --no-cache fontconfig ttf-dejavu
WORKDIR /app

COPY --from=build /build/target/admin_core_service.jar admin_core_service.jar
EXPOSE 8072

CMD ["java", "-XX:+UseG1GC", "-XX:MaxGCPauseMillis=200", "-XX:+UseContainerSupport", "-XX:MaxRAMPercentage=75.0", "-Dspring.profiles.active=stage", "-jar", "admin_core_service.jar"]