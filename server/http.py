"""HTTP server and SimpleHTTPHandler moved from app.py"""
import os
import json
import io
import logging
from http.server import HTTPServer, BaseHTTPRequestHandler
from . import state
from . import chunk_store
from .session import save_session_realtime

logger = logging.getLogger(__name__)


class SimpleHTTPHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        static_dir = os.path.join(os.path.dirname(__file__), '..', 'static')
        if self.path == '/':
            self.path = '/index.html'
        if self.path == '/api/server-info':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            external_ip = 'localhost'
            info = {'external_ip': external_ip, 'minecraft_port': 19131, 'connection_string': f'/connect {external_ip}:19131'}
            self.wfile.write(json.dumps(info).encode())
            return
        if self.path.startswith('/api/export-session/'):
            session_name = self.path.split('/')[-1]
            session_file_path = os.path.join(state.DATA_DIR, f"{session_name}.json")
            try:
                if os.path.exists(session_file_path):
                    self.send_response(200)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Content-Disposition', f'attachment; filename="{session_name}.json"')
                    self.end_headers()
                    with open(session_file_path, 'rb') as f:
                        self.wfile.write(f.read())
                    logger.info(f"📁 Exported session file: {session_name}.json")
                    return
                else:
                    self.send_response(404)
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({'error': 'Session file not found'}).encode())
                    return
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())
                logger.error(f"Error exporting session: {e}")
                return
        if self.path == '/api/rubric':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            rubric_path = os.path.join(os.path.dirname(__file__), '..', 'rubric.md')
            try:
                with open(rubric_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                response = {'content': content}
            except FileNotFoundError:
                response = {'content': '# Assessment Rubric\n\nNo rubric file found. Create your rubric here.'}
            except Exception as e:
                response = {'content': f'Error reading rubric: {str(e)}'}
            self.wfile.write(json.dumps(response).encode())
            return
        # Return assembled column stacks for a chunk (useful for client-side meshing)
        if self.path.startswith('/api/chunk-stacks/'):
            try:
                parts = self.path[len('/api/chunk-stacks/'):].split('/')
                if len(parts) != 3:
                    raise ValueError('expected /api/chunk-stacks/<dim>/<x>/<z>')
                dim = parts[0]
                x = int(parts[1])
                z = int(parts[2])
                stacks = chunk_store.assemble_chunk_column_stacks(dim, x, z)
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'stacks': stacks}).encode())
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())
            return
        if self.path == '/api/download-assessment':
            try:
                if not state.latest_assessment_results.get('analyses'):
                    self.send_response(404)
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({'error': 'No assessment results available'}).encode())
                    return
                from docx import Document
                doc = Document()
                # Minimal fallback document
                doc.add_heading('Assessment', 0)
                from io import BytesIO
                bio = BytesIO()
                doc.save(bio)
                bio.seek(0)
                doc_bytes = bio.read()
                timestamp = 'now'
                filename = f'minecraft_assessment_{timestamp}.docx'
                self.send_response(200)
                self.send_header('Content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
                self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
                self.send_header('Content-Length', str(len(doc_bytes)))
                self.end_headers()
                self.wfile.write(doc_bytes)
                logger.info(f"📄 Generated assessment document: {filename}")
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())
                logger.error(f"Error generating assessment document: {e}")
            return
        # static file serving
        clean_path = self.path.split('?')[0]
        if '..' in clean_path:
            self.send_response(403)
            self.end_headers()
            return
        content_types = {'.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json'}
        file_ext = os.path.splitext(clean_path)[1]
        content_type = content_types.get(file_ext, 'text/plain')
        file_path = os.path.join(static_dir, clean_path.lstrip('/'))
        try:
            with open(file_path, 'rb') as f:
                content = f.read()
            self.send_response(200)
            self.send_header('Content-type', content_type)
            self.end_headers()
            self.wfile.write(content)
        except FileNotFoundError:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'File not found')

    def do_POST(self):
        if self.path == '/api/rubric':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                content = data.get('content', '')
                rubric_path = os.path.join(os.path.dirname(__file__), '..', 'rubric.md')
                if os.path.exists(rubric_path):
                    backup_path = rubric_path + '.backup'
                    with open(rubric_path, 'r', encoding='utf-8') as f:
                        backup_content = f.read()
                    with open(backup_path, 'w', encoding='utf-8') as f:
                        f.write(backup_content)
                with open(rubric_path, 'w', encoding='utf-8') as f:
                    f.write(content)
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'success': True}).encode())
                logger.info("📝 Rubric updated successfully")
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())
                logger.error(f"Error saving rubric: {e})")
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


def run_http_server():
    server = HTTPServer(('0.0.0.0', 8080), SimpleHTTPHandler)
    logger.info("🌐 Web interface running at http://localhost:8080")
    server.serve_forever()
