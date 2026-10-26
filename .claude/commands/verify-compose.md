---
description: Build and verify the whole compose stack with the smoke test
---

Run `make smoke` (builds the stack, runs every check, tears it down). Report which checks passed and failed, quoting failing output. If it fails, look at `docker compose logs` before guessing at a cause.
