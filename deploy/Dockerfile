FROM python:3.11-slim

WORKDIR /app

# Non-root user (required by Hugging Face Spaces)
RUN useradd -m -u 1000 appuser

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .
COPY static ./static

# SQLite DB is created next to main.py at runtime; make it writable
RUN chown -R appuser:appuser /app
USER appuser

ENV PORT=7860
EXPOSE 7860

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
