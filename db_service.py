import mysql.connector
from mysql.connector import pooling


db_config = {

}

pool: pooling.MySQLConnectionPool = None


def init_db():
    """Initialize MySQL pool and create/update the minimum schema."""
    global pool
    try:
        pool = mysql.connector.pooling.MySQLConnectionPool(
            pool_name="mypool",
            pool_size=5,
            **db_config
        )
        print("Connected to MySQL Database 'smart_home'")

        with pool.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS sensor_logs (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    sensor_type VARCHAR(50),
                    value VARCHAR(50),
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            try:
                cur.execute("CREATE INDEX idx_sensor_logs_timestamp ON sensor_logs (timestamp)")
            except mysql.connector.Error:
                pass
            try:
                cur.execute("CREATE INDEX idx_sensor_logs_type_timestamp ON sensor_logs (sensor_type, timestamp)")
            except mysql.connector.Error:
                pass
            cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(255) NOT NULL UNIQUE,
                    email VARCHAR(255) NULL,
                    password VARCHAR(255) NOT NULL,
                    role VARCHAR(20) NOT NULL DEFAULT 'user',
                    is_active TINYINT(1) NOT NULL DEFAULT 1,
                    last_login DATETIME NULL
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS notifications (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    type VARCHAR(20) NOT NULL DEFAULT 'info',
                    title VARCHAR(255) NOT NULL,
                    message TEXT NOT NULL,
                    sender VARCHAR(100) NOT NULL DEFAULT 'system',
                    audience VARCHAR(20) NOT NULL DEFAULT 'private',
                    target_user VARCHAR(255) NULL,
                    is_read TINYINT(1) NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS mqtt_config (
                    id INT PRIMARY KEY,
                    host VARCHAR(255) NOT NULL,
                    port INT NOT NULL,
                    username VARCHAR(255),
                    password VARCHAR(255),
                    client_id VARCHAR(255),
                    keep_alive INT DEFAULT 60,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS rooms (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(100) NOT NULL UNIQUE,
                    floor_label VARCHAR(50) NULL,
                    icon VARCHAR(20) NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS scenes (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(100) NOT NULL UNIQUE,
                    description VARCHAR(255) NULL,
                    icon VARCHAR(20) NULL,
                    light_state VARCHAR(10) NOT NULL DEFAULT 'OFF',
                    door_state VARCHAR(10) NOT NULL DEFAULT 'CLOSED',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS scene_actions (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    scene_id INT NOT NULL,
                    device_id VARCHAR(100) NOT NULL,
                    target_state VARCHAR(10) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            try:
                cur.execute("ALTER TABLE scene_actions MODIFY COLUMN device_id VARCHAR(100) NOT NULL")
            except mysql.connector.Error:
                pass
            cur.execute("""
                INSERT INTO mqtt_config (id, host, port, username, password, client_id, keep_alive)
                VALUES (1, 'emqx.local', 1883, 'backend_service', '', 'smarthome-backend-01', 60)
                ON DUPLICATE KEY UPDATE id = id
            """)
            cur.execute("SELECT COUNT(*) FROM rooms")
            room_count = cur.fetchone()[0]
            if int(room_count or 0) == 0:
                cur.execute("""
                    INSERT INTO rooms (name, floor_label, icon)
                    VALUES
                        ('Living room', 'Tang 1', '🛋️'),
                        ('Bedroom', 'Tang 1', '🛏️'),
                        ('Kitchen', 'Tang 1', '🍳'),
                        ('Bathroom', 'Tang 1', '🚿'),
                        ('Garage', 'Tang 0', '🚗')
                """)
            cur.execute("""
                INSERT INTO scenes (name, description, icon, light_state, door_state)
                VALUES
                    ('home', 'Bat den, dong cua', '🏠', 'ON', 'CLOSED'),
                    ('sleep', 'Tat den, dong cua', '🌙', 'OFF', 'CLOSED'),
                    ('away', 'Tat den, dong cua', '🚗', 'OFF', 'CLOSED')
                ON DUPLICATE KEY UPDATE
                    description = VALUES(description),
                    icon = VALUES(icon),
                    light_state = VALUES(light_state),
                    door_state = VALUES(door_state)
            """)
            # Repair old seeded icons that were temporarily replaced with '?'.
            cur.execute("""
                UPDATE rooms
                SET icon = CASE name
                    WHEN 'Living room' THEN '🛋️'
                    WHEN 'Bedroom' THEN '🛏️'
                    WHEN 'Kitchen' THEN '🍳'
                    WHEN 'Bathroom' THEN '🚿'
                    WHEN 'Garage' THEN '🚗'
                    ELSE icon
                END
                WHERE icon = '?'
            """)
            cur.execute("""
                UPDATE scenes
                SET icon = CASE name
                    WHEN 'home' THEN '🏠'
                    WHEN 'sleep' THEN '🌙'
                    WHEN 'away' THEN '🚗'
                    ELSE icon
                END
                WHERE icon = '?'
            """)
            try:
                cur.execute("ALTER TABLE notifications ADD COLUMN audience VARCHAR(20) NOT NULL DEFAULT 'private'")
            except mysql.connector.Error:
                pass
            try:
                cur.execute("ALTER TABLE notifications ADD COLUMN target_user VARCHAR(255) NULL")
            except mysql.connector.Error:
                pass
            try:
                cur.execute("ALTER TABLE users ADD COLUMN email VARCHAR(255) NULL AFTER username")
            except mysql.connector.Error:
                pass
            try:
                cur.execute("ALTER TABLE users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER role")
            except mysql.connector.Error:
                pass
            try:
                cur.execute("ALTER TABLE users ADD COLUMN last_login DATETIME NULL AFTER is_active")
            except mysql.connector.Error:
                pass
            try:
                cur.execute("ALTER TABLE devices ADD COLUMN room_name VARCHAR(100) NULL AFTER name")
            except mysql.connector.Error:
                pass
            cur.execute("""
                INSERT INTO users (username, password, role)
                VALUES ('admin', 'admin', 'admin')
                ON DUPLICATE KEY UPDATE username = username
            """)
            cur.execute("""
                UPDATE users
                SET email = COALESCE(NULLIF(email, ''), 'admin@smarthome.vn'),
                    is_active = 1
                WHERE username = 'admin'
            """)
            conn.commit()
    except Exception as e:
        print("MySQL connection error:", e)


def get_conn():
    return pool.get_connection()
