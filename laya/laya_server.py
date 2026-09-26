"""Servidor HTTP local para el Router de Laya.

Se inicia y detiene junto al agente Node. El modelo se carga de forma diferida
al recibir la primera inferencia, para no retrasar el inicio de la CLI.
"""
import json
import os
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock

from laya import Router

HOST = os.environ.get("LAYA_HOST", "127.0.0.1")
PORT = int(os.environ.get("LAYA_PORT", "18765"))
PATH_PREFIX = os.environ.get("LAYA_PATH_PREFIX", "").rstrip("/")
MAX_BODY_BYTES = 1_000_000


class LayaHTTPServer(ThreadingHTTPServer):
    address_family = socket.AF_INET6 if HOST == "::1" else socket.AF_INET
    daemon_threads = True
    router = None
    router_lock = Lock()

    def get_router(self):
        if self.router is None:
            with self.router_lock:
                if self.router is None:
                    self.router = Router()
        return self.router


class LayaHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == f"{PATH_PREFIX}/health":
            self._send_json(200, {"ok": True, "service": "laya"})
        else:
            self._send_json(404, {"error": "Ruta no encontrada"})

    def do_POST(self) -> None:
        if self.path != f"{PATH_PREFIX}/predict":
            self._send_json(404, {"error": "Ruta no encontrada"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length < 1 or content_length > MAX_BODY_BYTES:
                self._send_json(413, {"error": "Tamaño de solicitud inválido"})
                return
            solicitud = json.loads(self.rfile.read(content_length))
            estado = solicitud["state"]
            preguntas = solicitud["questions"]
            resultado = self.server.get_router().predict(estado, preguntas)
            self._send_json(200, resultado)
        except (json.JSONDecodeError, KeyError, TypeError, ValueError) as error:
            self._send_json(400, {"error": f"Solicitud inválida: {error}"})
        except Exception as error:
            self.log_error("Error ejecutando Laya: %s", error)
            self._send_json(500, {"error": str(error)})

    def _send_json(self, status: int, data: object) -> None:
        contenido = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(contenido)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(contenido)

    def log_message(self, formato: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {formato % args}", flush=True)


def main() -> None:
    servidor = LayaHTTPServer((HOST, PORT), LayaHandler)
    print(f"Servidor Laya disponible en http://{HOST}:{PORT}", flush=True)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        servidor.server_close()
        print("Servidor Laya detenido.", flush=True)


if __name__ == "__main__":
    main()
