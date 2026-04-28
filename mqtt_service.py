import paho.mqtt.client as mqtt


MQTT_BROKER = "broker.emqx.io"
MQTT_PORT = 1883
MQTT_TOPIC_PREFIX = "smarthome/device/"

_mqtt_client = None


def create_mqtt_client(socketio, get_conn, create_notification, should_log_sensor, cleanup_old_sensor_logs, sensor_runtime_state):
    """Create and start the MQTT client used by the backend."""
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)

    def on_connect(client, userdata, flags, rc, properties=None):
        # Subscribe sensor topics once the broker connection is ready.
        if rc == 0:
            print("MQTT connected successfully.")
            client.subscribe("smarthome/sensor/#")
        else:
            print(f"MQTT connection failed with code: {rc}")

    def on_message(client, userdata, msg):
        # Receive sensor payload, push realtime updates, then optionally persist/notify.
        topic = msg.topic
        payload = msg.payload.decode().strip()

        print(f"MQTT sensor data [{topic}]: {payload}")

        sensor_type = None
        if "humidity" in topic:
            sensor_type = "humidity"
        elif "temperature" in topic:
            sensor_type = "temperature"
        elif "gas" in topic:
            sensor_type = "gas"

        if not sensor_type:
            return

        socketio.emit('sensor_update', {'type': sensor_type, 'value': payload})
        cleanup_old_sensor_logs()

        previous_seen = sensor_runtime_state.get(sensor_type, {}).get('last_seen')
        should_notify_gas = (
            sensor_type == "gas"
            and payload.upper() == "DANGER"
            and previous_seen != payload
        )
        should_log = should_log_sensor(sensor_type, payload)

        try:
            if should_log:
                with get_conn() as conn:
                    cur = conn.cursor()
                    cur.execute(
                        "INSERT INTO sensor_logs (sensor_type, value) VALUES (%s, %s)",
                        (sensor_type, payload)
                    )
                    conn.commit()
            if should_notify_gas:
                create_notification(
                    "warning",
                    "Canh bao ro ri khi gas",
                    "Phat hien trang thai DANGER tu cam bien gas.",
                    "system",
                    target_user="admin"
                )
        except Exception as e:
            print("Sensor log save error:", e)

    client.on_connect = on_connect
    client.on_message = on_message

    try:
        client.connect(MQTT_BROKER, MQTT_PORT, 60)
        client.loop_start()
    except Exception as e:
        print("Cannot start MQTT:", e)

    global _mqtt_client
    _mqtt_client = client
    return client


def publish_device_state(device_id, state):
    """Publish a device command to the broker if the client is available."""
    if not _mqtt_client:
        return False
    topic = f"{MQTT_TOPIC_PREFIX}{device_id}"
    _mqtt_client.publish(topic, state)
    return True
