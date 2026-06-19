#!/usr/bin/env python3
"""개발용 정적 서버 — 캐시를 끄고 항상 최신 파일을 내보낸다.

기본 python -m http.server 는 Cache-Control 헤더를 보내지 않아
크롬이 main.js / style.css 같은 파일을 캐시해버린다. 그러면 코드를
고쳐도 일반 새로고침으로는 반영되지 않는다.

이 서버는 모든 응답에 캐시 무효화 헤더를 붙여, 새로고침(또는
주소 복붙)만 해도 항상 최신 버전이 보이도록 한다.

사용법:  python devserver.py [포트]   (기본 포트 8000)
"""
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        # 조건부 요청 헤더를 제거해 304(Not Modified)를 막고,
        # 항상 200으로 최신 본문을 전송한다.
        for h in ("If-Modified-Since", "If-None-Match"):
            if h in self.headers:
                del self.headers[h]
        return super().send_head()

    def end_headers(self):
        # 브라우저가 절대 캐시하지 않도록 강제
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    # 스레드 방식: 연결 하나가 묶여도 서버 전체가 멈추지 않는다.
    server = ThreadingHTTPServer(("", port), NoCacheHandler)
    print(f"No-cache dev server running at http://localhost:{port}  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        server.server_close()


if __name__ == "__main__":
    main()
