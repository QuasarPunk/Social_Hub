FROM python:3.12-slim
RUN pip install --no-cache-dir faster-whisper==1.2.1 av==15.1.0
WORKDIR /app
COPY server.py ./
RUN useradd --uid 1000 --create-home transcriber && mkdir /models && chown transcriber:transcriber /models
USER transcriber
ENV HF_HOME=/models PYTHONUNBUFFERED=1
CMD ["python", "server.py"]
