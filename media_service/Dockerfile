# Stage 1: Build the application
FROM maven:3.8.5-openjdk-17-slim AS build

# Set the working directory
WORKDIR /build

# Declare the build arguments
ARG GITHUB_TOKEN
ARG ACCESS_GITHUB_USERNAME
ARG JAVA_TOKEN
ARG SENTRY_AUTH_TOKEN

# Set environment variables
ENV JAVA_TOKEN=$JAVA_TOKEN
ENV ACCESS_GITHUB_USERNAME=$ACCESS_GITHUB_USERNAME
ENV SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN

# Copy the Maven settings file
COPY settings.xml ./

# Copy the project files
COPY . .

# Build the project with SENTRY_AUTH_TOKEN passed as Maven property
RUN mvn -s settings.xml clean install -DskipTests -Dsentry.authToken=$SENTRY_AUTH_TOKEN

# Stage 2: Package the application into the final image
FROM amazoncorretto:17-alpine

# Set the working directory
WORKDIR /app

# Copy the built jar file from the previous stage
COPY --from=build /build/target/media_service.jar media_service.jar

# libwebp-tools: cwebp and dwebp, used for the commerce image renditions (rendition/CwebpProcessCodec)
RUN apk add --no-cache msttcorefonts-installer fontconfig libwebp-tools

RUN update-ms-fonts

# Expose the port the application runs on
EXPOSE 8075

# Define the command to run the application
CMD ["java", "-XX:+UseG1GC", "-XX:MaxGCPauseMillis=200", "-XX:+UseContainerSupport", "-XX:MaxRAMPercentage=75.0", "-Dspring.profiles.active=stage", "-jar", "media_service.jar"]