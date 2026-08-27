#!/bin/bash
set -e

# Check if docker is available
if ! command -v docker &> /dev/null; then
    echo "Error: 'docker' command not found. Please install Docker first."
    exit 1
fi

# Check if the container already exists
if [ "$(docker ps -aq -f name=my-omni)" ]; then
    if [ ! "$(docker ps -q -f name=my-omni)" ]; then
        echo "Starting existing local database container 'my-omni'..."
        docker start my-omni
    else
        echo "Database container 'my-omni' is already running."
    fi
else
    echo "Creating and starting new AlloyDB Omni container 'my-omni'..."
    docker run --name my-omni \
        -e POSTGRES_PASSWORD=pg1234 \
        -p 5432:5432 \
        -d google/alloydbomni:16.8.0
fi

echo "Waiting for database container to be ready to accept connections..."
# Wait for pg_isready to succeed
until docker exec -i my-omni pg_isready -U postgres >/dev/null 2>&1; do
    echo "Still waiting for database..."
    sleep 2
done

echo "Database is ready!"

# Check if 'litellm' database exists, and create it if not
if ! docker exec -i my-omni psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='litellm'" | grep -q 1; then
    echo "Creating database 'litellm'..."
    docker exec -i my-omni psql -U postgres -c "CREATE DATABASE litellm;"
    echo "Database 'litellm' created successfully."
else
    echo "Database 'litellm' already exists."
fi
