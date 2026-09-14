FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir "argon2-cffi>=25,<26" "azure-data-tables>=12.7,<13" "azure-identity>=1.25,<2" "fastapi>=0.116,<1" "uvicorn[standard]>=0.35,<1"
COPY fruitfly_blackjack ./fruitfly_blackjack
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn fruitfly_blackjack.service:app --host 0.0.0.0 --port ${PORT}"]
