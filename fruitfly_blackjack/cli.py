from __future__ import annotations

import argparse
import os

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Fruitfly Blackjack API")
    parser.add_argument("--host", default=os.getenv("API_HOST", "127.0.0.1"))
    parser.add_argument("--port", default=int(os.getenv("API_PORT", "8000")), type=int)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()
    uvicorn.run("fruitfly_blackjack.service:app", host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
