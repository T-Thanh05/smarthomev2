from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS
from flask_socketio import SocketIO, join_room
import mysql.connector
import os
import time
import csv
import io
from datetime import date, datetime
from db_service import get_conn, init_db
from mqtt_service import create_mqtt_client, publish_device_state

app = Flask(__name__, static_folder='../frontend', static_url_path='')
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# Backend này gom 3 trách nhiệm chính:
# 1) REST API cho frontend
# 2) realtime qua Socket.IO
# 3) nhận/gửi dữ liệu thiết bị qua MQTT
# Chính sách giảm trùng lặp khi lưu log cảm biến xuống DB.
SENSOR_LOG_POLICY = {
    'temperature': {'min_interval': 30, 'change_threshold': 0.3},
    'humidity': {'min_interval': 30, 'change_threshold': 2.0},
    'gas': {'min_interval': 10, 'change_threshold': None},
}

sensor_runtime_state = {
    'temperature': {'last_seen': None, 'last_logged': None, 'last_logged_at': 0},
    'humidity': {'last_seen': None, 'last_logged': None, 'last_logged_at': 0},
    'gas': {'last_seen': None, 'last_logged': None, 'last_logged_at': 0},
}

LOG_RETENTION_DAYS = 90
LOG_CLEANUP_INTERVAL_SECONDS = 3600
last_sensor_cleanup_at = 0


def parse_numeric_sensor_value(value):
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def should_log_sensor(sensor_type, payload):
    """Quyết định khi nào giá trị cảm biến đủ "đáng kể" để lưu."""
    policy = SENSOR_LOG_POLICY.get(sensor_type, {'min_interval': 30, 'change_threshold': None})
    state = sensor_runtime_state.setdefault(sensor_type, {'last_seen': None, 'last_logged': None, 'last_logged_at': 0})
    now_ts = time.time()
    normalized_payload = str(payload).strip()
    previous_logged = state.get('last_logged')
    previous_logged_at = float(state.get('last_logged_at') or 0)

    state['last_seen'] = normalized_payload

    if previous_logged is None:
        state['last_logged'] = normalized_payload
        state['last_logged_at'] = now_ts
        return True

    if sensor_type == 'gas':
        if normalized_payload != previous_logged or (now_ts - previous_logged_at) >= policy['min_interval']:
            state['last_logged'] = normalized_payload
            state['last_logged_at'] = now_ts
            return True
        return False

    current_num = parse_numeric_sensor_value(normalized_payload)
    previous_num = parse_numeric_sensor_value(previous_logged)

    if current_num is None or previous_num is None:
        if normalized_payload != previous_logged or (now_ts - previous_logged_at) >= policy['min_interval']:
            state['last_logged'] = normalized_payload
            state['last_logged_at'] = now_ts
            return True
        return False

    value_changed_enough = abs(current_num - previous_num) >= float(policy['change_threshold'] or 0)
    interval_elapsed = (now_ts - previous_logged_at) >= policy['min_interval']

    if value_changed_enough or interval_elapsed:
        state['last_logged'] = normalized_payload
        state['last_logged_at'] = now_ts
        return True
    return False


def cleanup_old_sensor_logs(force=False):
    """Dọn log cũ định kỳ để bảng sensor_logs không phình mãi."""
    global last_sensor_cleanup_at
    now_ts = time.time()
    if not force and (now_ts - last_sensor_cleanup_at) < LOG_CLEANUP_INTERVAL_SECONDS:
        return 0

    deleted_rows = 0
    try:
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                f"""
                DELETE FROM sensor_logs
                WHERE timestamp < (NOW() - INTERVAL {int(LOG_RETENTION_DAYS)} DAY)
                """
            )
            deleted_rows = cur.rowcount or 0
            conn.commit()
        last_sensor_cleanup_at = now_ts
    except Exception as e:
        print("Sensor log cleanup error:", e)
    return deleted_rows

init_db()
cleanup_old_sensor_logs(force=True)

def serialize_datetimes(value):
    """Convert date/datetime values to ISO strings for JSON and socket payloads."""
    if isinstance(value, dict):
        return {k: serialize_datetimes(v) for k, v in value.items()}
    if isinstance(value, list):
        return [serialize_datetimes(item) for item in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value

def normalize_user_row(row):
    # Chuẩn hóa dữ liệu trả ra để frontend không phải xử lý null/kiểu dữ liệu lẫn lộn.
    row = serialize_datetimes(row)
    if isinstance(row, dict):
        row['email'] = row.get('email') or ''
        row['is_active'] = int(row.get('is_active') or 0)
    return row

def normalize_room_row(row):
    row = serialize_datetimes(row)
    if isinstance(row, dict):
        row['name'] = row.get('name') or ''
        row['floor_label'] = row.get('floor_label') or ''
        row['icon'] = row.get('icon') or ''
    return row

def normalize_device_row(row):
    row = serialize_datetimes(row)
    if isinstance(row, dict):
        row['room_name'] = row.get('room_name') or ''
    return row

def normalize_scene_row(row):
    row = serialize_datetimes(row)
    if isinstance(row, dict):
        row['name'] = row.get('name') or ''
        row['description'] = row.get('description') or ''
        row['icon'] = row.get('icon') or '🎬'
        row['light_state'] = (row.get('light_state') or 'OFF').upper()
        row['door_state'] = (row.get('door_state') or 'CLOSED').upper()
        row['actions'] = row.get('actions') or []
    return row

def create_notification(type_, title, message, sender='system', audience='private', target_user=None):
    """Insert notification into DB and broadcast via websocket.
    IMPORTANT: must never break main business flow if this fails.
    """
    try:
        with get_conn() as conn:
            cur = conn.cursor(dictionary=True)
            cur.execute(
                """
                INSERT INTO notifications (type, title, message, sender, audience, target_user, is_read)
                VALUES (%s, %s, %s, %s, %s, %s, 0)
                """,
                (type_, title, message, sender, audience, target_user)
            )
            notif_id = cur.lastrowid
            conn.commit()
            cur.execute(
                """
                SELECT id, type, title, message, sender, audience, target_user, is_read, created_at
                FROM notifications
                WHERE id = %s
                """,
                (notif_id,)
            )
            row = cur.fetchone()
        if row:
            row = serialize_datetimes(row)
            if audience == 'all':
                socketio.emit('notification_created', row, to='all_users')
            elif target_user:
                socketio.emit('notification_created', row, to=f"user:{target_user}")
        return row
    except Exception as e:
        print("⚠️ Không thể tạo notification:", e)
        return None

# --- CẤU HÌNH MQTT ---
def get_notification_filter(username, role):
    if role == 'admin':
        return "(audience = 'all' OR target_user = %s OR sender = %s)", (username, username)
    return "(audience = 'all' OR target_user = %s)", (username,)


@socketio.on('register_socket')
def register_socket(data):
    # Mỗi user được join room riêng để server bắn notification đúng người.
    username = (data or {}).get('username')
    if not username:
        return
    join_room('all_users')
    join_room(f"user:{username}")

mqtt_client = create_mqtt_client(
    socketio=socketio,
    get_conn=get_conn,
    create_notification=create_notification,
    should_log_sensor=should_log_sensor,
    cleanup_old_sensor_logs=cleanup_old_sensor_logs,
    sensor_runtime_state=sensor_runtime_state,
)


@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_frontend(path):
    # Nếu path không khớp file thật, trả về index.html để frontend router tiếp quản.
    if path != "" and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    else:
        return send_from_directory(app.static_folder, 'index.html')

# --- API LỊCH SỬ ---
@app.route('/api/history', methods=['GET'])
def get_history():
    # API log cảm biến: cho phép lọc linh hoạt theo ngày, giờ và loại sensor.
    try:
        date_value = (request.args.get('date') or '').strip()
        from_time = (request.args.get('fromTime') or '').strip()
        to_time = (request.args.get('toTime') or '').strip()
        from_datetime = (request.args.get('fromDateTime') or '').strip()
        to_datetime = (request.args.get('toDateTime') or '').strip()
        sensor_type = (request.args.get('sensorType') or '').strip()
        response_format = (request.args.get('format') or 'json').strip().lower()
        where_clauses = []
        params = []

        if from_datetime:
            where_clauses.append("timestamp >= %s")
            params.append(from_datetime)
        if to_datetime:
            where_clauses.append("timestamp <= %s")
            params.append(to_datetime)

        if date_value and not from_datetime and not to_datetime:
            if from_time:
                where_clauses.append("timestamp >= %s")
                params.append(f"{date_value} {from_time}:00")
            else:
                where_clauses.append("DATE(timestamp) = %s")
                params.append(date_value)

            if to_time:
                where_clauses.append("timestamp <= %s")
                params.append(f"{date_value} {to_time}:59")

        if sensor_type:
            where_clauses.append("sensor_type = %s")
            params.append(sensor_type)

        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        with get_conn() as conn:
            cur = conn.cursor(dictionary=True)
            cur.execute(
                f"SELECT * FROM sensor_logs {where_sql} ORDER BY timestamp DESC LIMIT 300",
                params
            )
            rows = cur.fetchall()
        if response_format == 'csv':
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(['id', 'sensor_type', 'value', 'timestamp'])
            for row in rows:
                writer.writerow([
                    row.get('id', ''),
                    row.get('sensor_type', ''),
                    row.get('value', ''),
                    serialize_datetimes(row.get('timestamp', '')),
                ])
            csv_text = output.getvalue()
            output.close()
            filename = f"sensor_history_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
            return Response(
                csv_text,
                mimetype='text/csv; charset=utf-8',
                headers={'Content-Disposition': f'attachment; filename={filename}'}
            )
        return jsonify(serialize_datetimes(rows))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/notifications', methods=['GET'])
def get_notifications():
    # Lấy notification theo phạm vi mà user hiện tại được phép nhìn thấy.
    try:
        username = (request.args.get('username') or '').strip()
        role = (request.args.get('role') or 'user').strip().lower()
        if not username:
            return jsonify([]), 200
        where_sql, where_params = get_notification_filter(username, role)
        with get_conn() as conn:
            cur = conn.cursor(dictionary=True)
            cur.execute(
                f"""
                SELECT id, type, title, message, sender, audience, target_user, is_read, created_at
                FROM notifications
                WHERE {where_sql}
                ORDER BY created_at DESC
                LIMIT 200
                """,
                where_params
            )
            rows = cur.fetchall()
        return jsonify(serialize_datetimes(rows))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/notifications', methods=['POST'])
def post_notification():
    data = request.json or {}
    type_ = data.get('type', 'info')
    title = data.get('title', '').strip()
    message = data.get('message', '').strip()
    sender = data.get('sender', 'system')
    audience = (data.get('audience') or 'private').strip().lower()
    target_user = (data.get('targetUser') or '').strip() or None
    if not title or not message:
        return jsonify(success=False, message='Thiếu title hoặc message'), 400
    if audience != 'all' and not target_user:
        target_user = sender
    row = create_notification(type_, title, message, sender, audience, target_user)
    if row is None:
        return jsonify(success=False, message='Không thể tạo thông báo'), 500
    return jsonify(success=True, notification=row)

@app.route('/api/notifications/<int:notif_id>/read', methods=['PUT'])
def mark_notification_read(notif_id):
    try:
        username = (request.args.get('username') or '').strip()
        role = (request.args.get('role') or 'user').strip().lower()
        if not username:
            return jsonify(success=False, message='Thiáº¿u username'), 400
        where_sql, where_params = get_notification_filter(username, role)
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                f"UPDATE notifications SET is_read = 1 WHERE id = %s AND {where_sql}",
                (notif_id, *where_params)
            )
            conn.commit()
        return jsonify(success=True)
    except Exception as e:
        return jsonify(success=False, error=str(e)), 500

@app.route('/api/notifications/read-all', methods=['PUT'])
def mark_all_notifications_read():
    try:
        username = (request.args.get('username') or '').strip()
        role = (request.args.get('role') or 'user').strip().lower()
        if not username:
            return jsonify(success=False, message='Thiáº¿u username'), 400
        where_sql, where_params = get_notification_filter(username, role)
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                f"UPDATE notifications SET is_read = 1 WHERE is_read = 0 AND {where_sql}",
                where_params
            )
            conn.commit()
        return jsonify(success=True)
    except Exception as e:
        return jsonify(success=False, error=str(e)), 500

@app.route('/api/mqtt-config', methods=['GET'])
def get_mqtt_config():
    try:
        with get_conn() as conn:
            cur = conn.cursor(dictionary=True)
            cur.execute(
                """
                SELECT host, port, username, password, client_id, keep_alive, updated_at
                FROM mqtt_config
                WHERE id = 1
                """
            )
            row = cur.fetchone()
        return jsonify(serialize_datetimes(row or {}))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/mqtt-config', methods=['PUT'])
def save_mqtt_config():
    # Chỉ lưu cấu hình vào DB; việc reconnect MQTT thật có thể xử lý ở bước khác nếu cần.
    data = request.json or {}
    host = data.get('host', '').strip()
    port = int(data.get('port') or 1883)
    username = data.get('username', '').strip()
    password = data.get('password', '')
    client_id = data.get('clientId', '').strip()
    keep_alive = int(data.get('keepAlive') or 60)
    if not host:
        return jsonify(success=False, message='Host không được để trống'), 400
    try:
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                UPDATE mqtt_config
                SET host = %s, port = %s, username = %s, password = %s, client_id = %s, keep_alive = %s
                WHERE id = 1
                """,
                (host, port, username, password, client_id, keep_alive)
            )
            conn.commit()
        create_notification(
            "info",
            "MQTT config updated",
            f"{host}:{port} ({client_id})",
            "system",
            target_user="admin"
        )
        return jsonify(success=True)
    except Exception as e:
        return jsonify(success=False, error=str(e)), 500

@app.route('/api/mqtt-config/test', methods=['POST'])
def test_mqtt_config():
    data = request.json or {}
    host = data.get('host', '').strip()
    port = data.get('port')
    if not host or not port:
        return jsonify(success=False, message='Host/port không hợp lệ'), 400
    # Mock test endpoint for UI
    return jsonify(success=True, connected=True)

# --- API NGƯỜI DÙNG & THIẾT BỊ ---
@app.route('/api/login', methods=['POST'])
def login():
    # Login hiện tại dành cho môi trường học tập/demo, chưa dùng password hash.
    data = request.json or {}
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()
    with get_conn() as conn:
        cur = conn.cursor(dictionary=True)
        cur.execute(
            """
            SELECT id, username, email, role, is_active, last_login
            FROM users
            WHERE username = %s AND password = %s
            """,
            (username, password)
        )
        row = cur.fetchone()
        if row and int(row.get('is_active') or 0) != 1:
            return jsonify(success=False, message='Tài khoản này đang bị khóa!')
        if row:
            cur.execute("UPDATE users SET last_login = NOW() WHERE id = %s", (row['id'],))
            conn.commit()
            cur.execute(
                """
                SELECT id, username, email, role, is_active, last_login
                FROM users
                WHERE id = %s
                """,
                (row['id'],)
            )
            row = cur.fetchone()
    if row:
        return jsonify(success=True, user=normalize_user_row(row))
    return jsonify(success=False, message='Sai tài khoản hoặc mật khẩu!')

@app.route('/api/register', methods=['POST'])
def register():
    data = request.json or {}
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()
    email = (data.get('email') or '').strip() or f"{username}@smarthome.vn"
    if not username or not password:
        return jsonify(success=False, message='Thiếu tên tài khoản hoặc mật khẩu!'), 400
    try:
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO users (username, email, password, role, is_active)
                VALUES (%s, %s, %s, 'user', 1)
                """,
                (username, email, password)
            )
            conn.commit()
        return jsonify(success=True, message='Đăng ký thành công!')
    except mysql.connector.Error as err:
        if err.errno == mysql.connector.errorcode.ER_DUP_ENTRY:
            return jsonify(success=False, message='Tên tài khoản này đã có người sử dụng!')
        return jsonify(error=str(err)), 500

@app.route('/api/forgot-password', methods=['POST'])
def forgot_password():
    data = request.json
    username = data.get('username')
    new_password = data.get('newPassword')
    with get_conn() as conn:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT * FROM users WHERE username = %s", (username,))
        user = cur.fetchone()
        if user:
            cur.execute("UPDATE users SET password = %s WHERE username = %s", (new_password, username))
            conn.commit()
            return jsonify(success=True, message='Đặt lại mật khẩu thành công!')
    return jsonify(success=False, message='Không tìm thấy tài khoản này!')

@app.route('/api/change-password', methods=['POST'])
def change_password():
    data = request.json
    username = data.get('username')
    old_password = data.get('oldPassword')
    new_password = data.get('newPassword')
    with get_conn() as conn:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT * FROM users WHERE username = %s AND password = %s", (username, old_password))
        user = cur.fetchone()
        if user:
            cur.execute("UPDATE users SET password = %s WHERE username = %s", (new_password, username))
            conn.commit()
            return jsonify(success=True, message='Đổi mật khẩu thành công!')
    return jsonify(success=False, message='Mật khẩu cũ không chính xác!')

@app.route('/api/users', methods=['GET'])
def get_users():
    # Trả danh sách user để trang admin render bảng quản trị.
    with get_conn() as conn:
        cur = conn.cursor(dictionary=True)
        cur.execute("""
            SELECT id, username, email, role, is_active, last_login
            FROM users
            ORDER BY
                CASE WHEN role = 'admin' THEN 0 ELSE 1 END,
                username ASC
        """)
        rows = cur.fetchall()
    return jsonify([normalize_user_row(row) for row in rows])

@app.route('/api/users', methods=['POST'])
def create_user():
    data = request.json or {}
    username = (data.get('username') or '').strip()
    email = (data.get('email') or '').strip()
    password = (data.get('password') or '').strip()
    role = (data.get('role') or 'user').strip().lower()
    is_active = 1 if bool(data.get('isActive', True)) else 0

    if not username or not password:
        return jsonify(success=False, message='Thiếu tên tài khoản hoặc mật khẩu!'), 400

    try:
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO users (username, email, password, role, is_active)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (username, email or f"{username}@smarthome.vn", password, role, is_active)
            )
            conn.commit()
        return jsonify(success=True, message='Đã thêm người dùng!')
    except mysql.connector.Error as err:
        if err.errno == mysql.connector.errorcode.ER_DUP_ENTRY:
            return jsonify(success=False, message='Tài khoản hoặc email đã tồn tại!')
        return jsonify(success=False, message=str(err)), 500

@app.route('/api/users/<int:user_id>/role', methods=['PUT'])
def update_role(user_id):
    data = request.json
    role = data.get('role')
    with get_conn() as conn:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT username FROM users WHERE id = %s", (user_id,))
        user = cur.fetchone()
        if user and user['username'].lower() == 'admin':
            return jsonify(success=False, message='🛑 CẢNH BÁO: Không thể tước quyền của Admin gốc!')
        cur.execute("UPDATE users SET role = %s WHERE id = %s", (role, user_id))
        conn.commit()
    return jsonify(success=True)

@app.route('/api/users/<int:user_id>', methods=['PUT'])
def update_user(user_id):
    data = request.json or {}
    username = (data.get('username') or '').strip()
    email = (data.get('email') or '').strip()
    role = (data.get('role') or 'user').strip().lower()
    password = (data.get('password') or '').strip()
    is_active = 1 if bool(data.get('isActive', True)) else 0

    if not username:
        return jsonify(success=False, message='Thiếu tên tài khoản!'), 400

    with get_conn() as conn:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT id, username FROM users WHERE id = %s", (user_id,))
        user = cur.fetchone()
        if not user:
            return jsonify(success=False, message='Không tìm thấy người dùng!'), 404
        if user['username'].lower() == 'admin':
            role = 'admin'
            is_active = 1

        try:
            if password:
                cur.execute(
                    """
                    UPDATE users
                    SET username = %s, email = %s, role = %s, is_active = %s, password = %s
                    WHERE id = %s
                    """,
                    (username, email or f"{username}@smarthome.vn", role, is_active, password, user_id)
                )
            else:
                cur.execute(
                    """
                    UPDATE users
                    SET username = %s, email = %s, role = %s, is_active = %s
                    WHERE id = %s
                    """,
                    (username, email or f"{username}@smarthome.vn", role, is_active, user_id)
                )
            conn.commit()
            return jsonify(success=True, message='Đã cập nhật người dùng!')
        except mysql.connector.Error as err:
            if err.errno == mysql.connector.errorcode.ER_DUP_ENTRY:
                return jsonify(success=False, message='Tài khoản hoặc email đã tồn tại!')
            return jsonify(success=False, message=str(err)), 500

@app.route('/api/users/<int:user_id>', methods=['DELETE'])
def delete_user(user_id):
    with get_conn() as conn:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT username FROM users WHERE id = %s", (user_id,))
        user = cur.fetchone()
        if user and user['username'].lower() == 'admin':
            return jsonify(success=False, message='🛑 CẢNH BÁO: Không thể xóa tài khoản Admin gốc!')
        cur.execute("DELETE FROM users WHERE id = %s", (user_id,))
        conn.commit()
    return jsonify(success=True)

@app.route('/api/devices', methods=['GET'])
def get_devices():
    with get_conn() as conn:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT * FROM devices")
        rows = cur.fetchall()
    return jsonify([normalize_device_row(row) for row in rows])

@app.route('/api/rooms', methods=['GET'])
def get_rooms():
    try:
        with get_conn() as conn:
            cur = conn.cursor(dictionary=True)
            cur.execute(
                """
                SELECT id, name, floor_label, icon, created_at
                FROM rooms
                ORDER BY name ASC
                """
            )
            rows = cur.fetchall()
        return jsonify([normalize_room_row(row) for row in rows])
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/rooms', methods=['POST'])
def add_room():
    # Sau khi thêm room, emit event để các client đang mở tự đồng bộ lại UI.
    data = request.json or {}
    name = (data.get('name') or '').strip()
    floor_label = (data.get('floorLabel') or '').strip()
    icon = (data.get('icon') or '').strip()

    if not name:
        return jsonify(success=False, message='Thiếu tên khu vực'), 400

    try:
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO rooms (name, floor_label, icon) VALUES (%s, %s, %s)",
                (name, floor_label or None, icon or None)
            )
            conn.commit()
        socketio.emit('room_list_updated')
        return jsonify(success=True)
    except mysql.connector.Error as err:
        if err.errno == mysql.connector.errorcode.ER_DUP_ENTRY:
            return jsonify(success=False, message='Khu vực đã tồn tại'), 400
        return jsonify(success=False, message=str(err)), 500


@app.route('/api/rooms/<int:room_id>', methods=['DELETE'])
def delete_room(room_id):
    try:
        with get_conn() as conn:
            cur = conn.cursor(dictionary=True)
            cur.execute("SELECT name FROM rooms WHERE id = %s", (room_id,))
            room = cur.fetchone()
            if not room:
                return jsonify(success=False, message='Khong tim thay khu vuc'), 404

            room_name = room['name']
            cur = conn.cursor()
            cur.execute("UPDATE devices SET room_name = NULL WHERE room_name = %s", (room_name,))
            cur.execute("DELETE FROM rooms WHERE id = %s", (room_id,))
            conn.commit()
        socketio.emit('room_list_updated')
        socketio.emit('device_list_updated')
        return jsonify(success=True)
    except Exception as e:
        return jsonify(success=False, message=str(e)), 500


@app.route('/api/scenes', methods=['GET'])
def get_scenes():
    # Ghép scene với danh sách action con để frontend chỉ cần gọi một API.
    try:
        with get_conn() as conn:
            cur = conn.cursor(dictionary=True)
            cur.execute(
                """
                SELECT id, name, description, icon, light_state, door_state, created_at, updated_at
                FROM scenes
                ORDER BY created_at ASC, id ASC
                """
            )
            rows = cur.fetchall()
            cur.execute(
                """
                SELECT sa.scene_id, sa.device_id, sa.target_state, d.name AS device_name, d.type AS device_type
                FROM scene_actions sa
                JOIN devices d ON d.id = sa.device_id
                ORDER BY sa.scene_id ASC, sa.id ASC
                """
            )
            action_rows = cur.fetchall()
        action_map = {}
        for action in action_rows:
            action_map.setdefault(action['scene_id'], []).append({
                'device_id': action['device_id'],
                'target_state': (action.get('target_state') or '').upper(),
                'device_name': action.get('device_name') or '',
                'device_type': action.get('device_type') or '',
            })
        normalized = []
        for row in rows:
            scene = normalize_scene_row(row)
            scene['actions'] = action_map.get(row['id'], [])
            normalized.append(scene)
        return jsonify(normalized)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/scenes', methods=['POST'])
def create_scene():
    data = request.json or {}
    name = (data.get('name') or '').strip()
    description = (data.get('description') or '').strip()
    icon = (data.get('icon') or '').strip() or '🎬'
    light_state = (data.get('lightState') or 'OFF').strip().upper()
    door_state = (data.get('doorState') or 'CLOSED').strip().upper()
    actions = data.get('actions') or []

    if not name:
        return jsonify(success=False, message='Thiếu tên scene!'), 400
    if light_state not in ('ON', 'OFF'):
        light_state = 'OFF'
    if door_state not in ('OPEN', 'CLOSED'):
        door_state = 'CLOSED'

    try:
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO scenes (name, description, icon, light_state, door_state)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (name, description or None, icon, light_state, door_state)
            )
            scene_id = cur.lastrowid
            for action in actions:
                device_id = str(action.get('deviceId') or '').strip()
                target_state = (action.get('targetState') or '').strip().upper()
                if not device_id or target_state not in ('ON', 'OFF', 'OPEN', 'CLOSED'):
                    continue
                cur.execute(
                    """
                    INSERT INTO scene_actions (scene_id, device_id, target_state)
                    VALUES (%s, %s, %s)
                    """,
                    (scene_id, device_id, target_state)
                )
            conn.commit()
        return jsonify(success=True)
    except mysql.connector.Error as err:
        if err.errno == mysql.connector.errorcode.ER_DUP_ENTRY:
            return jsonify(success=False, message='Scene đã tồn tại!'), 400
        return jsonify(success=False, message=str(err)), 500


@app.route('/api/scenes/<int:scene_id>', methods=['PUT'])
def update_scene(scene_id):
    data = request.json or {}
    name = (data.get('name') or '').strip()
    description = (data.get('description') or '').strip()
    icon = (data.get('icon') or '').strip() or '🎬'
    light_state = (data.get('lightState') or 'OFF').strip().upper()
    door_state = (data.get('doorState') or 'CLOSED').strip().upper()
    actions = data.get('actions') or []

    if not name:
        return jsonify(success=False, message='Thiếu tên scene!'), 400
    if light_state not in ('ON', 'OFF'):
        light_state = 'OFF'
    if door_state not in ('OPEN', 'CLOSED'):
        door_state = 'CLOSED'

    try:
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                UPDATE scenes
                SET name = %s, description = %s, icon = %s, light_state = %s, door_state = %s
                WHERE id = %s
                """,
                (name, description or None, icon, light_state, door_state, scene_id)
            )
            cur.execute("DELETE FROM scene_actions WHERE scene_id = %s", (scene_id,))
            for action in actions:
                device_id = str(action.get('deviceId') or '').strip()
                target_state = (action.get('targetState') or '').strip().upper()
                if not device_id or target_state not in ('ON', 'OFF', 'OPEN', 'CLOSED'):
                    continue
                cur.execute(
                    """
                    INSERT INTO scene_actions (scene_id, device_id, target_state)
                    VALUES (%s, %s, %s)
                    """,
                    (scene_id, device_id, target_state)
                )
            conn.commit()
        return jsonify(success=True)
    except mysql.connector.Error as err:
        if err.errno == mysql.connector.errorcode.ER_DUP_ENTRY:
            return jsonify(success=False, message='Tên scene đã tồn tại!'), 400
        return jsonify(success=False, message=str(err)), 500


@app.route('/api/scenes/<int:scene_id>', methods=['DELETE'])
def delete_scene(scene_id):
    try:
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM scene_actions WHERE scene_id = %s", (scene_id,))
            cur.execute("DELETE FROM scenes WHERE id = %s", (scene_id,))
            conn.commit()
        return jsonify(success=True)
    except Exception as e:
        return jsonify(success=False, message=str(e)), 500

@app.route('/api/devices', methods=['POST'])
def add_device():
    # device_id được tạo động từ type + timestamp để đủ đơn giản và hạn chế trùng.
    data = request.json
    name = data.get('name')
    type_ = data.get('type')
    room_name = (data.get('roomName') or '').strip() or None
    sender = (data.get('sender') or 'admin').strip()
    device_id = f"{type_}_{int(time.time() * 1000)}"
    state = 'CLOSED' if type_ == 'door' else 'OFF'
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO devices (id, name, room_name, type, state) VALUES (%s, %s, %s, %s, %s)",
            (device_id, name, room_name, type_, state)
        )
        conn.commit()
    create_notification("success", "Thiết bị mới", f"Đã thêm thiết bị: {name}", "system")
    socketio.emit('device_list_updated')
    return jsonify(success=True)

@app.route('/api/devices/<device_id>', methods=['DELETE'])
def remove_device(device_id):
    with get_conn() as conn:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT name FROM devices WHERE id = %s", (device_id,))
        row = cur.fetchone()
        device_name = row['name'] if row else device_id
        cur = conn.cursor()
        cur.execute("DELETE FROM devices WHERE id = %s", (device_id,))
        conn.commit()
    create_notification("warning", "Thiết bị đã xóa", f"Đã xóa thiết bị: {device_name}", "system")
    socketio.emit('device_list_updated')
    return jsonify(success=True)

@socketio.on('toggle_device')
def handle_toggle_device(data):
    # Đây là luồng điều khiển thiết bị realtime quan trọng nhất của ứng dụng.
    device_id = data.get('id')
    new_state = data.get('state')
    actor = (data.get('actor') or 'system').strip()
    try:
        with get_conn() as conn:
            cur = conn.cursor(dictionary=True)
            cur.execute("SELECT name, type FROM devices WHERE id = %s", (device_id,))
            dev = cur.fetchone()
            cur = conn.cursor()
            cur.execute("UPDATE devices SET state = %s WHERE id = %s", (new_state, device_id))
            conn.commit()
        socketio.emit('device_updated', data)
        if dev:
            create_notification(
                "info",
                "Device state changed",
                f"{dev['name']} -> {new_state}",
                actor,
                target_user=actor
            )
        
        publish_device_state(device_id, new_state)
    except Exception as e:
        print("Lỗi toggle_device:", e)

if __name__ == '__main__':
    app.debug = True
    socketio.run(app, host='0.0.0.0', port=3000)
