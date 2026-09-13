# EVs Eye local manual acceptance

This is the complete local MVP path. It starts PostgreSQL, Redis, MinIO (private S3-compatible object storage), the API, and the operations web app. The Compose `seed` job creates an idempotent demo client and photo requirements.

## Start the stack

```sh
cp .env.example .env
docker compose up --build
```

Wait for the `seed` job to finish successfully, then open:

- Operations app: `http://localhost:3001`
- API health: `http://localhost:3000/health/ready`
- Local object-storage console: `http://localhost:9001`

The local MinIO console credentials are `evseye-minio` / `evseye-minio-local-password`. They are development-only values and must never be used outside this local Compose stack.

## Login

1. Enter client workspace slug `demo` and mobile `+919000000000`.
2. Send OTP. The application switches to the verification step.
3. Enter `123456`. This fixed code works only when `NODE_ENV=development`.
4. Confirm the dashboard opens and the browser has no uncaught error.

## Operations workflow

1. In **Locations**, create a hub.
2. In **Riders**, create a rider, open the record, upload a profile photo, and change the rider status to `ACTIVE`.
3. In **Fleet**, create a scooter assigned to the hub. Open it, add a battery and controller, then upload each required fleet, battery, and controller photo. The onboarding status must become ready.
4. Register an IoT device from the fleet detail. Copy the one-time ingestion secret before closing the detail pane.
5. In **Allocations**, allocate the available fleet to the active rider.
6. Open the pre-allocation inspection, upload each required inspection photo, complete it, then activate the allocation.
7. Initiate deallocation. Open the post-deallocation inspection and upload/complete all required photos.
8. Request and verify the rider and operator OTPs (use `123456` for each in development), then complete the deallocation. The fleet must return to `AVAILABLE`.
9. Open **Audit** and confirm actions such as rider, fleet, allocation, inspection, media, and deallocation changes are present.

The photo upload flow is browser → presigned MinIO URL → API completion metadata. The bucket is private; use the application rather than public object URLs to access evidence.

## IoT ingestion check

Use the device number and ingestion secret copied during registration. Replace the placeholders below:

```sh
curl --request POST http://localhost:3000/api/v1/iot/ingest \
  --header 'Content-Type: application/json' \
  --header 'x-device-secret: <INGEST_SECRET>' \
  --data '{"deviceNumber":"<DEVICE_NUMBER>","type":"LOCATION","latitude":19.0760,"longitude":72.8777,"speedKph":21.5,"ignition":true}'

curl --request POST http://localhost:3000/api/v1/iot/ingest \
  --header 'Content-Type: application/json' \
  --header 'x-device-secret: <INGEST_SECRET>' \
  --data '{"deviceNumber":"<DEVICE_NUMBER>","type":"HEARTBEAT","ignition":true}'

curl --request POST http://localhost:3000/api/v1/iot/ingest \
  --header 'Content-Type: application/json' \
  --header 'x-device-secret: <INGEST_SECRET>' \
  --data '{"deviceNumber":"<DEVICE_NUMBER>","type":"START","ignition":true}'

curl --request POST http://localhost:3000/api/v1/iot/ingest \
  --header 'Content-Type: application/json' \
  --header 'x-device-secret: <INGEST_SECRET>' \
  --data '{"deviceNumber":"<DEVICE_NUMBER>","type":"STOP","ignition":false}'
```

Reopen the fleet detail to confirm current location/heartbeat. Return to the dashboard to confirm the online count. It becomes offline after `IOT_OFFLINE_THRESHOLD_SECONDS` without another heartbeat.

## Final local checks

```sh
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
docker compose config --quiet
```

Expected outcomes:

- A second operator cannot allocate the same fleet.
- Client-scoped APIs reject records belonging to another client.
- OTP resend is throttled and wrong codes are limited.
- Required evidence blocks inspection and onboarding completion.
- Health endpoints remain available under API rate limiting.
