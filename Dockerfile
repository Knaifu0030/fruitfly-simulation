FROM python:3.11-slim
WORKDIR /app
COPY pyproject.toml README.md ./
COPY fruitfly_blackjack ./fruitfly_blackjack
RUN pip install --no-cache-dir .
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn fruitfly_blackjack.service:app --host 0.0.0.0 --port ${PORT}"]
