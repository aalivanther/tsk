# The Story Keeper

Film and TV premieres in Mexico on two timelines, with trailers, cast, sagas and where to watch.
Your profile keeps what you watched and links it into a constellation of actors, directors and genres.
Demo: https://akyrion.tech/tsk/

## Run locally

1. Install Docker with Compose v2; the whole toolchain runs in the `tools` container.
2. `cp .env.example .env` and set `SESSION_SIGNING_KEY` (`openssl rand -hex 32`).
3. `make tools-build && make gen && make up`
4. Open http://127.0.0.1:3000 (API on :8080).
5. `make verify` runs codegen, lint and tests; `make seed` refreshes the catalog from TMDB with your token.
