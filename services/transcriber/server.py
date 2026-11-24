import io
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from faster_whisper import WhisperModel


def catalog_prompt(directory):
    names = []
    for file in sorted(directory.glob("*/profile.json")):
        if file.parent.name.startswith("_"):
            continue
        with file.open(encoding="utf8") as source:
            profile = json.load(source)
        if profile.get("active") is True and isinstance(profile.get("name"), str):
            name = " ".join(profile["name"].split())
            if name:
                names.append(name)
    vocabulary = ", ".join(dict.fromkeys(names))
    if 0 < len(vocabulary) <= 240:
        return "Transcripcion en espanol. Nombres propios: " + vocabulary + "."
    return None


model_name = os.getenv("WHISPER_MODEL", "small")
model = WhisperModel(model_name, device="cpu", compute_type="int8",
                     cpu_threads=int(os.getenv("WHISPER_THREADS", "4")), local_files_only=True)
initial_prompt = catalog_prompt(Path("/projects")) if os.getenv("WHISPER_PROJECT_PROMPT", "1") == "1" else None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass

    def reply(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if self.path == "/health":
            self.reply(200, {"ready": True})
        else:
            self.reply(404, {})

    def do_POST(self):
        if self.path != "/transcribe":
            self.reply(404, {})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 20 * 1024 * 1024:
                self.reply(400, {"error": "invalid_audio_size"})
                return
            self.connection.settimeout(30)
            audio = self.rfile.read(size)
            segments, _ = model.transcribe(io.BytesIO(audio), language="es", beam_size=3, vad_filter=True,
                                           initial_prompt=initial_prompt)
            text = " ".join(segment.text.strip() for segment in segments if segment.text.strip())
            self.reply(200, {"text": text, "model": model_name, "catalog_prompt": initial_prompt is not None})
        except Exception as error:
            print("transcription_failed", type(error).__name__, flush=True)
            self.reply(422, {"error": "transcription_failed"})


HTTPServer(("0.0.0.0", 8090), Handler).serve_forever()
