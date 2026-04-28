/* SmartHome UI (template-like) wired to your existing backend.
   - Auth: /api/login, localStorage key `smartHomeUser`
   - Devices: /api/devices + socket events:
       emit: 'toggle_device' {id, state}
       on: 'device_updated', 'device_list_updated'
   - Sensors realtime: socket event 'sensor_update' {type, value}
   - History: /api/history
   - Users (admin): /api/users, PUT /api/users/:id/role, DELETE /api/users/:id
*/

const socket = io();
const STORAGE_KEY = 'smartHomeUser';

// "state" là kho dữ liệu trung tâm của frontend.
// Phần lớn hàm trong file này sẽ đọc từ đây rồi render lại UI.
const state = {
  devices: [],
  rooms: [],
  scenes: [],
  sensors: {
    temperature: null,
    humidity: null,
    gas: null,
  },
  users: [],
  scheduledTasks: [],
  activityLogs: [],
  commandHistory24h: Array.from({ length: 24 }, () => 0),
  selectedRoom: '',
  notifications: [],
  mqttConfig: null,
};

let currentUser = null;
let socketBound = false;
let scheduleTickerStarted = false;
let lastActionNotifAt = 0;
let historyAbsoluteRange = null;
let editingUserId = null;
let editingSceneId = null;

function el(id) { return document.getElementById(id); }

const LANG_KEY = 'smartHomeLang';
const THEME_KEY = 'smartHomeTheme';
let currentLang = localStorage.getItem(LANG_KEY) || 'vi';

const i18n = {
  "vi": {
    "login_subtitle": "Nền tảng điều khiển",
    "login_email": "Email / Tài khoản",
    "login_password": "Mật khẩu",
    "login_button": "Đăng nhập",
    "login_hint": "Dùng tài khoản đã tạo trong hệ thống",
    "nav_overview": "Tổng quan",
    "nav_rooms": "Khu vực",
    "nav_devices": "Thiết bị",
    "nav_controls": "Điều khiển",
    "nav_scenes": "Scene",
    "nav_schedules": "Lịch hẹn",
    "nav_system": "Hệ thống",
    "nav_notifications": "Thông báo",
    "nav_mqtt": "Cấu hình MQTT",
    "nav_history": "Nhật ký",
    "nav_users": "Người dùng",
    "top_realtime_label": "Realtime",
    "page_dashboard_title": "Dashboard",
    "page_dashboard_subtitle": "Cập nhật realtime từ MQTT",
    "btn_refresh": "Làm mới",
    "summary_total_badge": "Tổng",
    "summary_total_label": "Thiết bị",
    "summary_active_badge": "Đang hoạt động",
    "summary_lights_on_label": "Đèn bật",
    "summary_status_badge": "Trạng thái",
    "summary_doors_open_label": "Cửa đang mở",
    "summary_gas_danger_badge": "Cảnh báo",
    "summary_gas_label": "Khí gas",
    "card_environment_title": "Môi trường",
    "badge_live": "Live",
    "sensor_temp_avg": "Nhiệt độ trung bình",
    "sensor_hum_avg": "Độ ẩm trung bình",
    "sensor_gas_status": "Trạng thái gas",
    "dashboard_tip": "Mẹo: vào tab Thiết bị để điều khiển cửa và đèn.",
    "page_devices_title": "Tất cả thiết bị",
    "page_rooms_title": "Khu vực",
    "rooms_add_btn": "Thêm khu vực",
    "page_scenes_title": "Scene & Automation",
    "page_scenes_subtitle": "Demo UI: điều khiển bằng dữ liệu thật.",
    "scene_home_name": "Về nhà",
    "scene_home_desc": "Bật đèn, đóng cửa",
    "scene_sleep_name": "Đi ngủ",
    "scene_sleep_desc": "Tắt đèn, đóng cửa",
    "scene_away_name": "Ra ngoài",
    "scene_away_desc": "Tắt đèn, đóng cửa",
    "scene_activate_btn": "Kích hoạt",
    "page_schedules_title": "Lịch hẹn",
    "page_schedules_subtitle": "Demo UI lưu cục bộ và đồng bộ realtime.",
    "schedule_create_title": "Tạo lịch",
    "schedule_badge_local": "Cục bộ",
    "schedule_device_label": "Thiết bị",
    "schedule_time_label": "Giờ",
    "schedule_action_label": "Hành động",
    "schedule_action_on": "Bật / Mở",
    "schedule_action_off": "Tắt / Đóng",
    "schedule_save_btn": "Lưu lịch",
    "page_history_title": "Nhật ký cảm biến",
    "page_history_subtitle": "100 bản ghi gần nhất từ cơ sở dữ liệu.",
    "history_refresh_btn": "Làm mới",
    "th_id": "ID",
    "th_type": "Loại",
    "th_value": "Giá trị",
    "th_time": "Thời gian",
    "page_users_title": "Quản lý người dùng",
    "page_users_subtitle": "Chỉ dành cho admin.",
    "page_notifications_title": "Thông báo",
    "page_mqtt_title": "Cấu hình MQTT",
    "add_device_modal_title": "Thêm thiết bị mới",
    "add_device_name_label": "Tên thiết bị",
    "add_device_type_label": "Loại thiết bị",
    "add_device_type_light": "Đèn",
    "add_device_type_door": "Cửa/Khóa",
    "add_device_cancel_btn": "Hủy",
    "add_device_confirm_btn": "Thêm thiết bị",
    "gas_danger_badge": "Nguy hiểm",
    "gas_safe_badge": "An toàn",
    "toast_login_success": "Đăng nhập thành công!",
    "toast_login_error_missing": "Vui lòng nhập thông tin đăng nhập.",
    "toast_server_error": "Lỗi kết nối máy chủ!",
    "toast_light_on": "Đã bật",
    "toast_light_off": "Đã tắt",
    "toast_door_open": "Đang mở",
    "toast_door_closed": "Đã khóa",
    "toast_scene_activated_prefix": "Scene",
    "toast_commands_word": "lệnh",
    "toast_schedule_saved": "Đã lưu lịch lúc",
    "toast_schedule_removed": "Đã xóa lịch",
    "toast_schedule_executed_prefix": "Lịch",
    "toast_history_loading": "Đang tải dữ liệu...",
    "toast_history_empty": "Không có dữ liệu lịch sử",
    "toast_history_error": "Không thể tải lịch sử",
    "users_only_admin": "Chỉ admin mới có thể xem.",
    "users_loading": "Đang tải danh sách người dùng...",
    "users_empty": "Chưa có người dùng nào."
  },
  "en": {
    "login_subtitle": "Control Platform",
    "login_email": "Email / Account",
    "login_password": "Password",
    "login_button": "Login",
    "login_hint": "Use the account created in your system",
    "nav_overview": "Overview",
    "nav_rooms": "Rooms",
    "nav_devices": "Devices",
    "nav_controls": "Controls",
    "nav_scenes": "Scenes",
    "nav_schedules": "Schedules",
    "nav_system": "System",
    "nav_notifications": "Notifications",
    "nav_mqtt": "MQTT Config",
    "nav_history": "Logs",
    "nav_users": "Users",
    "top_realtime_label": "Realtime",
    "page_dashboard_title": "Dashboard",
    "page_dashboard_subtitle": "Realtime updates via MQTT",
    "btn_refresh": "Refresh",
    "summary_total_badge": "Total",
    "summary_total_label": "Devices",
    "summary_active_badge": "Active",
    "summary_lights_on_label": "Lights on",
    "summary_status_badge": "Status",
    "summary_doors_open_label": "Doors open",
    "summary_gas_danger_badge": "Danger",
    "summary_gas_label": "Gas",
    "card_environment_title": "Environment",
    "badge_live": "Live",
    "sensor_temp_avg": "Average temperature",
    "sensor_hum_avg": "Average humidity",
    "sensor_gas_status": "Gas status",
    "dashboard_tip": "Tip: go to the Devices tab to control doors and lights.",
    "page_devices_title": "All devices",
    "page_rooms_title": "Rooms",
    "rooms_add_btn": "Add room",
    "page_scenes_title": "Scene & Automation",
    "page_scenes_subtitle": "Demo UI: control using real data.",
    "scene_home_name": "Home",
    "scene_home_desc": "Turn lights on, close doors",
    "scene_sleep_name": "Sleep",
    "scene_sleep_desc": "Turn lights off, close doors",
    "scene_away_name": "Away",
    "scene_away_desc": "Turn lights off, close doors",
    "scene_activate_btn": "Activate",
    "page_schedules_title": "Schedules",
    "page_schedules_subtitle": "Demo UI (local, with realtime toggle).",
    "schedule_create_title": "Create schedule",
    "schedule_badge_local": "Local",
    "schedule_device_label": "Device",
    "schedule_time_label": "Time",
    "schedule_action_label": "Action",
    "schedule_action_on": "ON / OPEN",
    "schedule_action_off": "OFF / CLOSE",
    "schedule_save_btn": "Save schedule",
    "page_history_title": "Sensor logs",
    "page_history_subtitle": "Last 100 records (from DB).",
    "history_refresh_btn": "Refresh",
    "th_id": "ID",
    "th_type": "Type",
    "th_value": "Value",
    "th_time": "Time",
    "page_users_title": "User management",
    "page_users_subtitle": "Admin only.",
    "page_notifications_title": "Notifications",
    "page_mqtt_title": "MQTT Config",
    "add_device_modal_title": "Add new device",
    "add_device_name_label": "Device name",
    "add_device_type_label": "Device type",
    "add_device_type_light": "Light",
    "add_device_type_door": "Door/Lock",
    "add_device_cancel_btn": "Cancel",
    "add_device_confirm_btn": "Add device",
    "gas_danger_badge": "Danger",
    "gas_safe_badge": "Safe",
    "toast_login_success": "Login success!",
    "toast_login_error_missing": "Please fill in your login information.",
    "toast_server_error": "Server connection error!",
    "toast_light_on": "Turned on",
    "toast_light_off": "Turned off",
    "toast_door_open": "Opening",
    "toast_door_closed": "Locked",
    "toast_scene_activated_prefix": "Scene",
    "toast_commands_word": "commands",
    "toast_schedule_saved": "Schedule set at",
    "toast_schedule_removed": "Schedule removed",
    "toast_schedule_executed_prefix": "Schedule",
    "toast_history_loading": "Loading data...",
    "toast_history_empty": "No history data",
    "toast_history_error": "Failed to load history",
    "users_only_admin": "Only admin can view.",
    "users_loading": "Loading users...",
    "users_empty": "No users yet."
  }
};


function t(key) {
  return i18n[currentLang]?.[key] ?? key;
}

function applyLang() {
  // Đồng bộ toàn bộ text/placeholder theo ngôn ngữ hiện tại.
  document.querySelectorAll('[data-i18n]').forEach(node => {
    const key = node.getAttribute('data-i18n');
    if (!key) return;
    const value = t(key);
    if (value) node.textContent = value;
  });

  const btnLang = el('btnLang');
  if (btnLang) btnLang.textContent = currentLang === 'vi' ? 'VI' : 'EN';

  // userRole is set by JS, not via data-i18n
  const roleEl = el('userRole');
  if (roleEl && currentUser) {
    const role = (currentUser.role || '').toLowerCase();
    roleEl.textContent = role === 'admin'
      ? (currentLang === 'vi' ? 'Quản trị viên' : 'Administrator')
      : (currentLang === 'vi' ? 'Người dùng' : 'User');
  }

  const markAllBtn = el('btnMarkAllRead');
  if (markAllBtn) markAllBtn.textContent = currentLang === 'vi' ? 'Đã đọc tất cả' : 'Mark all read';

  const loginUsername = el('loginUsername');
  if (loginUsername) loginUsername.placeholder = currentLang === 'vi' ? 'Nhập tài khoản' : 'Enter your account';

  const loginPassword = el('loginPassword');
  if (loginPassword) loginPassword.placeholder = currentLang === 'vi' ? 'Mật khẩu' : 'Password';

  const loginToRegisterLink = el('loginToRegisterLink');
  if (loginToRegisterLink) loginToRegisterLink.textContent = currentLang === 'vi' ? 'Chưa có tài khoản? Tạo tài khoản' : 'No account yet? Create one';

  const loginToForgotLink = el('loginToForgotLink');
  if (loginToForgotLink) loginToForgotLink.textContent = currentLang === 'vi' ? 'Quên mật khẩu?' : 'Forgot password?';

  const registerPanelTitle = el('registerPanelTitle');
  if (registerPanelTitle) registerPanelTitle.textContent = currentLang === 'vi' ? 'Tạo tài khoản' : 'Create account';

  const registerPanelSub = el('registerPanelSub');
  if (registerPanelSub) registerPanelSub.textContent = currentLang === 'vi'
    ? 'Tạo tài khoản mới để đăng nhập và sử dụng hệ thống.'
    : 'Create a new account to sign in and use the system.';

  const registerUsernameLabel = el('registerUsernameLabel');
  if (registerUsernameLabel) registerUsernameLabel.textContent = currentLang === 'vi' ? 'Tài khoản' : 'Username';

  const registerEmailLabel = el('registerEmailLabel');
  if (registerEmailLabel) registerEmailLabel.textContent = 'Email';

  const registerPasswordLabel = el('registerPasswordLabel');
  if (registerPasswordLabel) registerPasswordLabel.textContent = currentLang === 'vi' ? 'Mật khẩu' : 'Password';

  const registerPasswordConfirmLabel = el('registerPasswordConfirmLabel');
  if (registerPasswordConfirmLabel) registerPasswordConfirmLabel.textContent = currentLang === 'vi' ? 'Nhập lại mật khẩu' : 'Confirm password';

  const registerUsername = el('registerUsername');
  if (registerUsername) registerUsername.placeholder = currentLang === 'vi' ? 'Chọn tên tài khoản' : 'Choose a username';

  const registerEmail = el('registerEmail');
  if (registerEmail) registerEmail.placeholder = currentLang === 'vi' ? 'Nhập email của bạn' : 'Enter your email';

  const registerPassword = el('registerPassword');
  if (registerPassword) registerPassword.placeholder = currentLang === 'vi' ? 'Tạo mật khẩu' : 'Create a password';

  const registerPasswordConfirm = el('registerPasswordConfirm');
  if (registerPasswordConfirm) registerPasswordConfirm.placeholder = currentLang === 'vi' ? 'Nhập lại mật khẩu' : 'Confirm your password';

  const registerSubmitBtn = el('registerSubmitBtn');
  if (registerSubmitBtn) registerSubmitBtn.textContent = currentLang === 'vi' ? 'Tạo tài khoản' : 'Create account';

  const registerToLoginLink = el('registerToLoginLink');
  if (registerToLoginLink) registerToLoginLink.textContent = currentLang === 'vi' ? 'Đã có tài khoản? Đăng nhập' : 'Already have an account? Sign in';

  const registerToForgotLink = el('registerToForgotLink');
  if (registerToForgotLink) registerToForgotLink.textContent = currentLang === 'vi' ? 'Quên mật khẩu?' : 'Forgot password?';

  const forgotPanelTitle = el('forgotPanelTitle');
  if (forgotPanelTitle) forgotPanelTitle.textContent = currentLang === 'vi' ? 'Quên mật khẩu' : 'Forgot password';

  const forgotPanelSub = el('forgotPanelSub');
  if (forgotPanelSub) forgotPanelSub.textContent = currentLang === 'vi'
    ? 'Nhập tài khoản và tạo lại mật khẩu mới để tiếp tục đăng nhập.'
    : 'Enter your account and create a new password to continue signing in.';

  const forgotUsernameLabel = el('forgotUsernameLabel');
  if (forgotUsernameLabel) forgotUsernameLabel.textContent = currentLang === 'vi' ? 'Tài khoản' : 'Username';

  const forgotNewPasswordLabel = el('forgotNewPasswordLabel');
  if (forgotNewPasswordLabel) forgotNewPasswordLabel.textContent = currentLang === 'vi' ? 'Mật khẩu mới' : 'New password';

  const forgotNewPasswordConfirmLabel = el('forgotNewPasswordConfirmLabel');
  if (forgotNewPasswordConfirmLabel) forgotNewPasswordConfirmLabel.textContent = currentLang === 'vi' ? 'Nhập lại mật khẩu mới' : 'Confirm new password';

  const forgotUsername = el('forgotUsername');
  if (forgotUsername) forgotUsername.placeholder = currentLang === 'vi' ? 'Nhập tài khoản' : 'Enter your account';

  const forgotNewPassword = el('forgotNewPassword');
  if (forgotNewPassword) forgotNewPassword.placeholder = currentLang === 'vi' ? 'Nhập mật khẩu mới' : 'Enter a new password';

  const forgotNewPasswordConfirm = el('forgotNewPasswordConfirm');
  if (forgotNewPasswordConfirm) forgotNewPasswordConfirm.placeholder = currentLang === 'vi' ? 'Xác nhận mật khẩu mới' : 'Confirm new password';

  const forgotSubmitBtn = el('forgotSubmitBtn');
  if (forgotSubmitBtn) forgotSubmitBtn.textContent = currentLang === 'vi' ? 'Đặt lại mật khẩu' : 'Reset password';

  const forgotToLoginLink = el('forgotToLoginLink');
  if (forgotToLoginLink) forgotToLoginLink.textContent = currentLang === 'vi' ? 'Quay lại đăng nhập' : 'Back to sign in';

  const forgotToRegisterLink = el('forgotToRegisterLink');
  if (forgotToRegisterLink) forgotToRegisterLink.textContent = currentLang === 'vi' ? 'Tạo tài khoản mới' : 'Create a new account';

  const sceneAddBtnLabel = el('sceneAddBtnLabel');
  if (sceneAddBtnLabel) sceneAddBtnLabel.textContent = currentLang === 'vi' ? 'Thêm scene' : 'Add scene';

  const sceneNameLabel = el('sceneNameLabel');
  if (sceneNameLabel) sceneNameLabel.textContent = currentLang === 'vi' ? 'Tên scene' : 'Scene name';

  const sceneDescriptionLabel = el('sceneDescriptionLabel');
  if (sceneDescriptionLabel) sceneDescriptionLabel.textContent = currentLang === 'vi' ? 'Mô tả' : 'Description';

  const sceneIconLabel = el('sceneIconLabel');
  if (sceneIconLabel) sceneIconLabel.textContent = 'Icon';

  const sceneDevicesLabel = el('sceneDevicesLabel');
  if (sceneDevicesLabel) sceneDevicesLabel.textContent = currentLang === 'vi' ? 'Thiết bị trong scene' : 'Devices in scene';

  const sceneDevicesHint = el('sceneDevicesHint');
  if (sceneDevicesHint) sceneDevicesHint.textContent = currentLang === 'vi'
    ? 'Tick hoặc bấm vào dòng thiết bị để thêm vào scene.'
    : 'Tick the checkbox or click a device row to add it to the scene.';

  const sceneName = el('sceneName');
  if (sceneName) sceneName.placeholder = currentLang === 'vi' ? 'Ví dụ: Tiếp khách' : 'Example: Welcome guests';

  const sceneDescription = el('sceneDescription');
  if (sceneDescription) sceneDescription.placeholder = currentLang === 'vi' ? 'Bật đèn, mở cửa' : 'Turn lights on, open doors';

  const adminNotifyTitle = el('adminNotifyTitle');
  if (adminNotifyTitle) adminNotifyTitle.textContent = currentLang === 'vi' ? 'Thông báo từ admin' : 'Admin broadcast';

  const notifyTitleLabel = el('notifyTitleLabel');
  if (notifyTitleLabel) notifyTitleLabel.textContent = currentLang === 'vi' ? 'Tiêu đề' : 'Title';

  const notifyMessageLabel = el('notifyMessageLabel');
  if (notifyMessageLabel) notifyMessageLabel.textContent = currentLang === 'vi' ? 'Nội dung' : 'Message';

  const notifyTitleInput = el('notifyTitle');
  if (notifyTitleInput) {
    notifyTitleInput.placeholder = currentLang === 'vi'
      ? 'Ví dụ: Bảo trì hệ thống lúc 22:00'
      : 'Example: System maintenance at 22:00';
  }

  const notifyMessageInput = el('notifyMessage');
  if (notifyMessageInput) {
    notifyMessageInput.placeholder = currentLang === 'vi'
      ? 'Nhập nội dung thông báo gửi toàn bộ người dùng'
      : 'Enter a broadcast message for all users';
  }

  const sendAdminNotifyBtn = el('sendAdminNotifyBtn');
  if (sendAdminNotifyBtn) sendAdminNotifyBtn.textContent = currentLang === 'vi' ? 'Gửi thông báo' : 'Send notification';

  const filterDevices = el('filterDevices');
  if (filterDevices && filterDevices.options.length >= 3) {
    filterDevices.options[0].text = currentLang === 'vi' ? 'Tất cả loại' : 'All types';
    filterDevices.options[1].text = currentLang === 'vi' ? 'Cửa/Khóa' : 'Door/Lock';
    filterDevices.options[2].text = currentLang === 'vi' ? 'Đèn' : 'Light';
  }

  const btnAddDevice = el('btnAddDevice');
  if (btnAddDevice) btnAddDevice.textContent = currentLang === 'vi' ? '+ Thêm thiết bị' : '+ Add device';

  const historyDateLabel = el('historyDateLabel');
  if (historyDateLabel) historyDateLabel.textContent = currentLang === 'vi' ? 'Ngày' : 'Date';

  const historyFromTimeLabel = el('historyFromTimeLabel');
  if (historyFromTimeLabel) historyFromTimeLabel.textContent = currentLang === 'vi' ? 'Từ thời điểm' : 'From time';

  const historyToTimeLabel = el('historyToTimeLabel');
  if (historyToTimeLabel) historyToTimeLabel.textContent = currentLang === 'vi' ? 'Đến thời điểm' : 'To time';

  const historySensorTypeLabel = el('historySensorTypeLabel');
  if (historySensorTypeLabel) historySensorTypeLabel.textContent = currentLang === 'vi' ? 'Loại cảm biến' : 'Sensor type';

  const historySensorType = el('historySensorType');
  if (historySensorType && historySensorType.options.length >= 4) {
    historySensorType.options[0].text = currentLang === 'vi' ? 'Tất cả' : 'All';
    historySensorType.options[1].text = currentLang === 'vi' ? 'Nhiệt độ' : 'Temperature';
    historySensorType.options[2].text = currentLang === 'vi' ? 'Độ ẩm' : 'Humidity';
    historySensorType.options[3].text = 'Gas';
  }

  const historyTodayBtn = el('historyTodayBtn');
  if (historyTodayBtn) historyTodayBtn.textContent = currentLang === 'vi' ? 'Hôm nay' : 'Today';

  const historyLastHourBtn = el('historyLastHourBtn');
  if (historyLastHourBtn) historyLastHourBtn.textContent = currentLang === 'vi' ? '1 giờ gần nhất' : 'Last hour';

  const historyLast24HoursBtn = el('historyLast24HoursBtn');
  if (historyLast24HoursBtn) historyLast24HoursBtn.textContent = currentLang === 'vi' ? '24 giờ gần nhất' : 'Last 24 hours';

  const historyExportBtn = el('historyExportBtn');
  if (historyExportBtn) historyExportBtn.textContent = currentLang === 'vi' ? 'Xuất CSV' : 'Export CSV';

  const historyClearBtn = el('historyClearBtn');
  if (historyClearBtn) historyClearBtn.textContent = currentLang === 'vi' ? 'Xóa bộ lọc' : 'Clear filters';

  const historyLoadBtn = el('historyLoadBtn');
  if (historyLoadBtn) historyLoadBtn.textContent = currentLang === 'vi' ? 'Truy xuất dữ liệu' : 'Load data';

  const mqttSubtitle = el('mqttSubtitle');
  if (mqttSubtitle) mqttSubtitle.textContent = currentLang === 'vi' ? 'Kết nối và quản lý broker' : 'Connect and manage the broker';

  const mqttBrokerTitle = el('mqttBrokerTitle');
  if (mqttBrokerTitle) mqttBrokerTitle.textContent = 'MQTT Broker';

  const mqttHostLabel = el('mqttHostLabel');
  if (mqttHostLabel) mqttHostLabel.textContent = 'Host';

  const mqttPortLabel = el('mqttPortLabel');
  if (mqttPortLabel) mqttPortLabel.textContent = 'Port';

  const mqttUserLabel = el('mqttUserLabel');
  if (mqttUserLabel) mqttUserLabel.textContent = currentLang === 'vi' ? 'Tên đăng nhập' : 'Username';

  const mqttPassLabel = el('mqttPassLabel');
  if (mqttPassLabel) mqttPassLabel.textContent = currentLang === 'vi' ? 'Mật khẩu' : 'Password';

  const mqttClientIdLabel = el('mqttClientIdLabel');
  if (mqttClientIdLabel) mqttClientIdLabel.textContent = 'Client ID';

  const mqttKeepAliveLabel = el('mqttKeepAliveLabel');
  if (mqttKeepAliveLabel) mqttKeepAliveLabel.textContent = currentLang === 'vi' ? 'Giữ kết nối (giây)' : 'Keep Alive (s)';

  const mqttTestBtn = el('mqttTestBtn');
  if (mqttTestBtn) mqttTestBtn.textContent = currentLang === 'vi' ? 'Kiểm tra kết nối' : 'Test connection';

  const mqttSaveBtn = el('mqttSaveBtn');
  if (mqttSaveBtn) mqttSaveBtn.textContent = currentLang === 'vi' ? 'Lưu cấu hình' : 'Save settings';

  const mqttTopicTitle = el('mqttTopicTitle');
  if (mqttTopicTitle) mqttTopicTitle.textContent = currentLang === 'vi' ? 'Quy ước topic' : 'Topic convention';

  const mqttTopicCommand = el('mqttTopicCommand');
  if (mqttTopicCommand) mqttTopicCommand.textContent = currentLang === 'vi' ? 'Lệnh' : 'Command';

  const mqttTopicState = el('mqttTopicState');
  if (mqttTopicState) mqttTopicState.textContent = currentLang === 'vi' ? 'Trạng thái' : 'State';

  const mqttTopicSensor = el('mqttTopicSensor');
  if (mqttTopicSensor) mqttTopicSensor.textContent = currentLang === 'vi' ? 'Cảm biến' : 'Sensor';

  const mqttTopicAlert = el('mqttTopicAlert');
  if (mqttTopicAlert) mqttTopicAlert.textContent = currentLang === 'vi' ? 'Cảnh báo' : 'Alert';

  const mqttStatsTitle = el('mqttStatsTitle');
  if (mqttStatsTitle) mqttStatsTitle.textContent = currentLang === 'vi' ? 'Thống kê broker' : 'Broker statistics';

  const mqttStatConnectionsLabel = el('mqttStatConnectionsLabel');
  if (mqttStatConnectionsLabel) mqttStatConnectionsLabel.textContent = currentLang === 'vi' ? 'Kết nối hiện tại' : 'Current connections';
}

function updateThemeButton(theme) {
  const btn = el('btnTheme');
  if (!btn) return;
  btn.textContent = theme === 'light' ? 'Light' : 'Dark';
  btn.title = theme === 'light' ? 'Light mode' : 'Dark mode';
}

function syncTheme() {
  const theme = localStorage.getItem(THEME_KEY) || 'dark';
  document.documentElement.dataset.theme = theme;
  updateThemeButton(theme);
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
  updateThemeButton(next);
}

function toggleLang() {
  currentLang = currentLang === 'vi' ? 'en' : 'vi';
  localStorage.setItem(LANG_KEY, currentLang);
  applyLang();
  renderRooms();
  renderScenes();
  renderQuickScenes();
  renderDashboard();
  renderDevices();
  syncRoomFilterSelect();
  syncScheduleDeviceSelect();
  renderScheduleList();
}

function showLoginMsg(text) {
  const msg = el('loginMsg');
  if (!msg) return;
  if (text) msg.textContent = text;
  msg.classList.add('show');
}

function clearLoginMsg() {
  const msg = el('loginMsg');
  if (!msg) return;
  msg.classList.remove('show');
}

function showToast(message, type = 'info') {
  const container = el('toastContainer');
  if (!container) return;

  const icons = { success: '✓', error: '×', warning: '!', info: 'i' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-msg">${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 320);
  }, 3500);
}

function openModal(id) {
  const node = el(id);
  if (!node) return;
  node.classList.add('open');
}

function closeModal(id) {
  const node = el(id);
  if (!node) return;
  node.classList.remove('open');
}

function togglePasswordField(inputId, button) {
  const input = el(inputId);
  if (!input || !button) return;
  const nextType = input.type === 'password' ? 'text' : 'password';
  input.type = nextType;
  button.textContent = nextType === 'password' ? '👁' : '🙈';
}

function doLogout() {
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
}

function setupAuthPanels() {
  setAuthMode('login');
}

function setAuthMode(mode) {
  const modes = ['login', 'register', 'forgot'];
  modes.forEach(name => {
    const tab = el(`authTab${name.charAt(0).toUpperCase()}${name.slice(1)}`);
    const panel = el(`authPanel${name.charAt(0).toUpperCase()}${name.slice(1)}`);
    if (tab) tab.classList.toggle('active', name === mode);
    if (panel) panel.classList.toggle('active', name === mode);
  });
  clearLoginMsg();
}

async function doLogin() {
  clearLoginMsg();
  const username = (el('loginUsername')?.value || '').trim();
  const password = (el('loginPassword')?.value || '').trim();
  if (!username || !password) {
    showLoginMsg(t('toast_login_error_missing'));
    return;
  }

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!data.success) {
      showLoginMsg(data.message || 'Sai ti khon hoc mt khu');
      return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data.user));
    enterApp(data.user);
    showToast(t('toast_login_success'), 'success');
  } catch (e) {
    console.error(e);
    showLoginMsg(t('toast_server_error'));
  }
}

async function doRegister() {
  clearLoginMsg();
  const username = (el('registerUsername')?.value || '').trim();
  const email = (el('registerEmail')?.value || '').trim();
  const password = (el('registerPassword')?.value || '').trim();
  const confirmPassword = (el('registerPasswordConfirm')?.value || '').trim();

  if (!username || !email || !password || !confirmPassword) {
    showLoginMsg(currentLang === 'vi' ? 'Vui lòng nhập đầy đủ thông tin đăng ký.' : 'Please fill in all registration fields.');
    return;
  }
  if (password !== confirmPassword) {
    showLoginMsg(currentLang === 'vi' ? 'Mật khẩu nhập lại không khớp.' : 'Password confirmation does not match.');
    return;
  }

  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });
    const data = await res.json();
    if (!data.success) {
      showLoginMsg(data.message || (currentLang === 'vi' ? 'Không thể tạo tài khoản.' : 'Failed to create account.'));
      return;
    }

    setAuthMode('login');
    if (el('registerUsername')) el('registerUsername').value = '';
    if (el('registerEmail')) el('registerEmail').value = '';
    if (el('registerPassword')) el('registerPassword').value = '';
    if (el('registerPasswordConfirm')) el('registerPasswordConfirm').value = '';
    if (el('loginUsername')) el('loginUsername').value = username;
    if (el('loginPassword')) el('loginPassword').value = password;
    showLoginMsg(data.message || (currentLang === 'vi' ? 'Tạo tài khoản thành công, vui lòng đăng nhập.' : 'Account created successfully, please log in.'));
  } catch (e) {
    console.error(e);
    showLoginMsg(t('toast_server_error'));
  }
}

async function doForgotPassword() {
  clearLoginMsg();
  const username = (el('forgotUsername')?.value || '').trim();
  const newPassword = (el('forgotNewPassword')?.value || '').trim();
  const confirmPassword = (el('forgotNewPasswordConfirm')?.value || '').trim();

  if (!username || !newPassword || !confirmPassword) {
    showLoginMsg(currentLang === 'vi' ? 'Vui lòng nhập đầy đủ thông tin đặt lại mật khẩu.' : 'Please fill in all reset password fields.');
    return;
  }
  if (newPassword !== confirmPassword) {
    showLoginMsg(currentLang === 'vi' ? 'Mật khẩu nhập lại không khớp.' : 'Password confirmation does not match.');
    return;
  }

  try {
    const res = await fetch('/api/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, newPassword }),
    });
    const data = await res.json();
    if (!data.success) {
      showLoginMsg(data.message || (currentLang === 'vi' ? 'Không thể đặt lại mật khẩu.' : 'Failed to reset password.'));
      return;
    }

    setAuthMode('login');
    if (el('forgotUsername')) el('forgotUsername').value = '';
    if (el('forgotNewPassword')) el('forgotNewPassword').value = '';
    if (el('forgotNewPasswordConfirm')) el('forgotNewPasswordConfirm').value = '';
    if (el('loginUsername')) el('loginUsername').value = username;
    showLoginMsg(data.message || (currentLang === 'vi' ? 'Đặt lại mật khẩu thành công.' : 'Password reset successfully.'));
  } catch (e) {
    console.error(e);
    showLoginMsg(t('toast_server_error'));
  }
}

function openAccountModal() {
  if (!currentUser) return;
  if (el('accountUsername')) el('accountUsername').value = currentUser.username || '';
  if (el('accountOldPassword')) el('accountOldPassword').value = '';
  if (el('accountNewPassword')) el('accountNewPassword').value = '';
  if (el('accountConfirmPassword')) el('accountConfirmPassword').value = '';
  openModal('accountModal');
}

async function saveAccountPassword() {
  if (!currentUser) return;
  const oldPassword = (el('accountOldPassword')?.value || '').trim();
  const newPassword = (el('accountNewPassword')?.value || '').trim();
  const confirmPassword = (el('accountConfirmPassword')?.value || '').trim();

  if (!oldPassword || !newPassword || !confirmPassword) {
    showToast('Please fill in all password change fields.', 'warning');
    return;
  }
  if (newPassword !== confirmPassword) {
    showToast('Password confirmation does not match.', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser.username,
        oldPassword,
        newPassword,
      }),
    });
    const data = await res.json();
    if (!data.success) {
      showToast(data.message || 'Failed to change password.', 'error');
      return;
    }

    closeModal('accountModal');
    showToast(data.message || 'Password changed successfully.', 'success');
  } catch (e) {
    console.error(e);
    showToast(t('toast_server_error'), 'error');
  }
}

function setUserPanel(user) {
  currentUser = user || null;
  const usernameEl = el('userName');
  const roleEl = el('userRole');
  const avatarEl = el('userAvatar');
  if (!usernameEl || !roleEl || !avatarEl || !currentUser) return;

  const uname = currentUser.username || 'User';
  usernameEl.textContent = uname;
  avatarEl.textContent = uname.trim().charAt(0).toUpperCase();

  const role = (currentUser.role || '').toLowerCase();
  const roleLabels = {
    admin: 'Administrator',
    operator: 'Operator',
    viewer: 'Viewer',
    user: 'User',
  };
  roleEl.textContent = roleLabels[role] || roleLabels.user;

  const isAdmin = role === 'admin';
  const usersNav = el('nav-users');
  const addBtn = el('btnAddDevice');
  if (usersNav) usersNav.style.display = isAdmin ? 'flex' : 'none';
  if (addBtn) addBtn.style.display = isAdmin ? 'inline-flex' : 'none';
}

function bindSocketEventsOnce() {
  // Chỉ bind 1 lần để tránh mỗi lần login/render lại bị nhân đôi listener.
  if (socketBound) return;
  socketBound = true;

  socket.on('device_list_updated', async () => {
    await fetchDevices();
  });

  socket.on('room_list_updated', async () => {
    await fetchRooms();
    renderRooms();
  });

  socket.on('device_updated', (data) => {
    // data: {id, state}
    if (!data || !data.id) return;
    const dev = state.devices.find(d => d.id === data.id);
    if (!dev) return;
    dev.state = data.state;
    renderDevices();
    renderDashboard();
  });

  socket.on('sensor_update', (data) => {
    // data: {type: temperature|humidity|gas, value: payload}
    if (!data) return;
    if (data.type === 'temperature') state.sensors.temperature = data.value;
    if (data.type === 'humidity') state.sensors.humidity = data.value;
    if (data.type === 'gas') state.sensors.gas = data.value;
    renderDashboard();
  });

  socket.on('notification_created', (notif) => {
    if (!notif) return;
    upsertNotification(notif);
    renderNotifications();
  });
}

async function fetchDevices() {
  // Sau khi lấy device, cập nhật luôn các khu vực/tổng quan/select liên quan.
  const res = await fetch('/api/devices');
  const devices = await res.json();
  state.devices = enrichDevicesWithRoom(Array.isArray(devices) ? devices : []);
  renderRooms();
  renderDevices();
  renderDashboard();
  syncRoomFilterSelect();
  syncScheduleDeviceSelect();
}

async function fetchRooms() {
  try {
    const res = await fetch('/api/rooms');
    const rooms = await res.json();
    state.rooms = Array.isArray(rooms) ? rooms : [];
    syncRoomFilterSelect();
  } catch (e) {
    console.error('fetchRooms error:', e);
    state.rooms = [];
  }
}

function renderDashboard() {
  // Dashboard là phần tổng hợp nhanh từ state hiện tại, không gọi API riêng.
  const total = state.devices.length;
  const lights = state.devices.filter(d => d.type === 'light');
  const doors = state.devices.filter(d => d.type === 'door');

  const lightsOn = lights.filter(d => d.state === 'ON').length;
  const doorsOpen = doors.filter(d => d.state === 'OPEN').length;

  const temp = state.sensors.temperature;
  const hum = state.sensors.humidity;
  const gas = state.sensors.gas;

  const sumTotal = el('sumTotalDevices');
  const sumLights = el('sumLightsOn');
  const sumDoors = el('sumDoorsOpen');
  const dashTemp = el('dashTemp');
  const dashHum = el('dashHum');
  const dashGas = el('dashGas');
  const gasBadge = el('gasBadge');
  const sumGasState = el('sumGasState');
  const deviceSnapshot = el('deviceSnapshot');

  if (sumTotal) sumTotal.textContent = total;
  if (sumLights) sumLights.textContent = lightsOn;
  if (sumDoors) sumDoors.textContent = doorsOpen;

  if (dashTemp) dashTemp.textContent = temp !== null && temp !== undefined ? `${temp}C` : '--C';
  if (dashHum) dashHum.textContent = hum !== null && hum !== undefined ? `${hum}%` : '--%';

  // Gas: backend emits payload; existing frontend treated 'DANGER' as danger
  const isDanger = gas === 'DANGER';
  const gasText = gas === null || gas === undefined ? '--' : (isDanger ? t('gas_danger_badge') : t('gas_safe_badge'));

  if (dashGas) dashGas.textContent = gasText;
  if (gasBadge) {
    gasBadge.textContent = isDanger ? t('gas_danger_badge') : t('gas_safe_badge');
    gasBadge.classList.remove('badge-danger', 'badge-online');
    gasBadge.classList.add(isDanger ? 'badge-danger' : 'badge-online');
  }
  if (sumGasState) sumGasState.textContent = gas === null || gas === undefined ? '--' : (isDanger ? '!' : '');

  if (deviceSnapshot) {
    const snapTotalLabel = 'Total';
    const snapLightsLabel = 'Lights on';
    const snapDoorsLabel = 'Doors open';
    deviceSnapshot.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;font-size:13px">
        <span style="color:var(--text2);font-weight:700">${snapTotalLabel}</span>
        <span style="font-family:var(--font-mono);font-weight:900">${total}</span>
      </div>
      <div style="display:flex;justify-content:space-between;gap:10px;font-size:13px">
        <span style="color:var(--success);font-weight:800">${snapLightsLabel}</span>
        <span style="font-family:var(--font-mono);font-weight:900">${lightsOn}</span>
      </div>
      <div style="display:flex;justify-content:space-between;gap:10px;font-size:13px">
        <span style="color:var(--warning);font-weight:800">${snapDoorsLabel}</span>
        <span style="font-family:var(--font-mono);font-weight:900">${doorsOpen}</span>
      </div>
    `;
  }

  renderActivityTable();
  renderCommandChart();
}

function typeLabel(type) {
  if (type === 'light') return currentLang === 'vi' ? 'Đèn' : 'Light';
  if (type === 'door') return currentLang === 'vi' ? 'Cửa/Khóa' : 'Door/Lock';
  return type || (currentLang === 'vi' ? 'Thiết bị' : 'Device');
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function roomFromDeviceName(name) {
  const n = normalizeText(name);
  if (n.includes('phong khach') || n.includes('khach') || n.includes('living room')) return 'Living room';
  if (n.includes('phong ngu') || n.includes('ngu') || n.includes('bedroom')) return 'Bedroom';
  if (n.includes('phong bep') || n.includes('bep') || n.includes('kitchen')) return 'Kitchen';
  if (n.includes('garage') || n.includes('gara')) return 'Garage';
  if (n.includes('nha ve sinh') || n.includes('ve sinh') || n.includes('bathroom') || n.includes('toilet')) return 'Bathroom';
  return 'Other';
}

function roomIcon(room) {
  const map = {
    'Living room': '🛋️',
    'Bedroom': '🛏️',
    'Kitchen': '🍳',
    'Garage': '🚗',
    'Bathroom': '🚿',
    'Other': '🏠',
  };
  return map[room] || '🏠';
}

function getRoomText(roomName) {
  if (currentLang !== 'vi') return roomName;
  const map = {
    'Living room': 'Phòng khách',
    'Bedroom': 'Phòng ngủ',
    'Kitchen': 'Bếp',
    'Garage': 'Garage',
    'Bathroom': 'Nhà vệ sinh',
    'Other': 'Khác',
  };
  return map[roomName] || roomName;
}

function enrichDevicesWithRoom(devs) {
  return devs.map(d => ({ ...d, room: d.room_name || d.room || roomFromDeviceName(d.name) }));
}

function deviceEmoji(device) {
  const name = normalizeText(device?.name);
  if (name.includes('cam bien') && name.includes('nhiet')) return '🌡️';
  if (name.includes('cam bien') && name.includes('do am')) return '💧';
  if (name.includes('cam bien') || name.includes('sensor')) return '📟';
  if (name.includes('rem')) return '🪟';
  if (name.includes('quat')) return '🌀';
  if (name.includes('dieu hoa') || name.includes('may lanh') || name.includes('air')) return '❄️';
  if (device.type === 'light') return device.state === 'ON' ? '💡' : '🔅';
  if (device.type === 'door') return device.state === 'OPEN' ? '🚪' : '🔒';
  return '📦';
}

function getRoomsSummary() {
  const map = new Map();
  for (const room of state.rooms) {
    const normalizedName = room?.name || '';
    if (!normalizedName) continue;
    map.set(normalizedName, {
      id: room.id,
      room: normalizedName,
      total: 0,
      online: 0,
      offline: 0,
      icons: [],
      floorLabel: room.floor_label || '',
      icon: room.icon || roomIcon(normalizedName),
    });
  }
  for (const d of state.devices) {
    const room = d.room || 'Other';
    if (!map.has(room)) {
      map.set(room, {
        id: null,
        room,
        total: 0,
        online: 0,
        offline: 0,
        icons: [],
        floorLabel: room === 'Garage' ? 'Tầng 0' : 'Tầng 1',
        icon: roomIcon(room),
      });
    }
    const row = map.get(room);
    const isOnline = (d.type === 'light' && d.state === 'ON') || (d.type === 'door' && d.state === 'CLOSED');
    row.total += 1;
    if (isOnline) row.online += 1;
    else row.offline += 1;
    row.icons.push(deviceEmoji(d));
  }
  return Array.from(map.values()).sort((a, b) => a.room.localeCompare(b.room));
}

function renderDeviceCard(d) {
  const isOn = d.type === 'light' ? d.state === 'ON' : false;
  const isOpen = d.type === 'door' ? d.state === 'OPEN' : false;
  const icon = deviceEmoji(d);
  // Cho php mi ti khon ( ng nhp) c xo thit b
  const canDelete = !!currentUser;
  const deleteLabel = currentLang === 'vi' ? 'Xóa' : 'Delete';
  const deleteTitle = currentLang === 'vi' ? 'Xóa thiết bị' : 'Delete device';

  if (d.type === 'light') {
    const badge = isOn
      ? `<span class="badge badge-online"><span class="badge-dot"></span>${currentLang === 'vi' ? 'Online' : 'Online'}</span>`
      : `<span class="badge badge-offline"><span class="badge-dot"></span>${currentLang === 'vi' ? 'Offline' : 'Offline'}</span>`;

    const powerLabel = currentLang === 'vi' ? 'Nguồn' : 'Power';
    const offText = currentLang === 'vi' ? 'Tắt' : 'Turn off';
    const onText = currentLang === 'vi' ? 'Bật' : 'Turn on';

    return `
      <div class="device-card">
        <div class="device-header">
          <div class="device-icon-wrap">${icon}</div>
          <div style="display:flex;align-items:center;gap:6px">
            ${badge}
            ${canDelete ? `<button class="btn btn-secondary btn-sm" style="padding:0 8px;font-size:11px;height:24px" title="${deleteTitle}" onclick="deleteDevice('${d.id}')">${deleteLabel}</button>` : ''}
          </div>
        </div>
        <div class="device-name">${escapeHtml(d.name)}</div>
        <div class="device-room">${getRoomText(d.room || roomFromDeviceName(d.name))}</div>
        <div class="device-controls">
          <div class="toggle-wrap">
            <span class="toggle-label">${powerLabel}</span>
            <div class="toggle ${isOn ? 'on' : ''}" onclick="toggleDevice('${d.id}', '${isOn ? 'OFF' : 'ON'}')"></div>
          </div>
          <button class="btn ${isOn ? 'btn-secondary' : 'btn-success'} btn-sm" onclick="toggleDevice('${d.id}', '${isOn ? 'OFF' : 'ON'}')">
            ${isOn ? ` ${offText}` : ` ${onText}`}
          </button>
        </div>
      </div>
    `;
  }

  // door
  const openText = currentLang === 'vi' ? 'Mở' : 'Open';
  const closedText = currentLang === 'vi' ? 'Đóng' : 'Closed';
  const doorLabelText = currentLang === 'vi' ? 'Đang mở' : 'Opening';
  const lockLabelText = currentLang === 'vi' ? 'Đã khóa' : 'Locked';
  const doorNamePrefix = currentLang === 'vi' ? 'Cửa' : 'Door';
  const doorCloseBtnText = currentLang === 'vi' ? 'Đóng' : 'Close';
  const doorOpenBtnText = currentLang === 'vi' ? 'Mở' : 'Open';
  const badge = isOpen
    ? `<span class="badge badge-warning"><span class="badge-dot"></span>${openText}</span>`
    : `<span class="badge badge-online"><span class="badge-dot"></span>${closedText}</span>`;

  return `
    <div class="device-card">
      <div class="device-header">
        <div class="device-icon-wrap">${icon}</div>
        <div style="display:flex;align-items:center;gap:6px">
          ${badge}
          ${canDelete ? `<button class="btn btn-secondary btn-sm" style="padding:0 8px;font-size:11px;height:24px" title="${deleteTitle}" onclick="deleteDevice('${d.id}')">${deleteLabel}</button>` : ''}
        </div>
      </div>
      <div class="device-name">${escapeHtml(d.name)}</div>
      <div class="device-room">${getRoomText(d.room || roomFromDeviceName(d.name))}</div>
      <div class="device-controls">
        <div class="lock-display" style="background:var(--surface2);border-radius:8px;padding:10px 12px;border:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:22px">${icon}</span>
            <div>
              <div style="font-size:12px;font-weight:900;color:${isOpen ? 'var(--warning)' : 'var(--success)'}">${isOpen ? doorLabelText : lockLabelText}</div>
              <div style="font-size:11px;color:var(--text3);margin-top:1px">${doorNamePrefix} ${escapeHtml(d.name)}</div>
            </div>
          </div>
          <button class="btn ${isOpen ? 'btn-danger' : 'btn-success'} btn-sm" onclick="toggleDevice('${d.id}', '${isOpen ? 'CLOSED' : 'OPEN'}')">
            ${isOpen ? ` ${doorCloseBtnText}` : ` ${doorOpenBtnText}`}
          </button>
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderDevices() {
  // Màn hình thiết bị được render thuần từ state + bộ lọc hiện tại.
  const grid = el('devicesGrid');
  const subtitle = el('devicesSubtitle');
  const title = document.querySelector('#page-devices .page-title');
  if (!grid) return;

  const roomFilter = state.selectedRoom || '';
  const filter = el('filterDevices')?.value || '';
  let visible = state.devices;
  if (roomFilter) visible = visible.filter(d => d.room === roomFilter);
  if (filter) visible = visible.filter(d => d.type === filter);

  if (title) {
    title.textContent = roomFilter
      ? `${currentLang === 'vi' ? 'Thiết bị -' : 'Devices -'} ${getRoomText(roomFilter)}`
      : t('page_devices_title');
  }

  const total = visible.length;
  const lightsOn = visible.filter(d => d.type === 'light' && d.state === 'ON').length;
  const doorsOpen = visible.filter(d => d.type === 'door' && d.state === 'OPEN').length;
  if (subtitle) {
    subtitle.textContent = currentLang === 'vi'
      ? `${total} thiết bị - ${lightsOn} đèn bật, ${doorsOpen} cửa mở`
      : `${total} devices - ${lightsOn} lights on, ${doorsOpen} doors open`;
  }

  if (!visible.length) {
    grid.innerHTML = `
      <div class="card" style="grid-column:1/-1;background:transparent;border:none;padding:0">
        <div style="text-align:center;color:var(--text3);padding:28px 0">
          ${currentLang === 'vi' ? 'Không có thiết bị phù hợp với bộ lọc.' : 'No devices match the filter.'}
        </div>
      </div>
    `;
    return;
  }

  grid.innerHTML = visible.map(renderDeviceCard).join('');
}

function showDeviceToast(d, newState) {
  if (!d) return;
  if (d.type === 'light') {
    const isOn = newState === 'ON';
    const msg = isOn ? t('toast_light_on') : t('toast_light_off');
    showToast(`${d.name}: ${isOn ? '' : ''} ${msg}`, isOn ? 'success' : 'info');
    return;
  }
  if (d.type === 'door') {
    const isOpen = newState === 'OPEN';
    const msg = isOpen ? t('toast_door_open') : t('toast_door_closed');
    showToast(`${d.name}: ${isOpen ? '' : ''} ${msg}`, isOpen ? 'warning' : 'success');
  }
}

function toggleDevice(id, targetState) {
  const dev = state.devices.find(d => d.id === id);
  if (!dev) return;

  // Optimistic UI: đổi trạng thái ngay trên giao diện trước khi server phản hồi.
  dev.state = targetState;
  renderDevices();
  renderDashboard();
  showDeviceToast(dev, targetState);
  addActivityLog({
    deviceName: dev.name,
    deviceType: dev.type,
    action: targetState,
    actor: currentUser?.username || 'system',
    success: true,
  });
  incrementCommandCounter();

  socket.emit('toggle_device', { id, state: targetState, actor: currentUser?.username || 'system' });
}

async function deleteDevice(id) {
  const dev = state.devices.find(d => d.id === id);
  const name = dev?.name || id;
  const message = currentLang === 'vi'
    ? `Bạn có chắc muốn xóa thiết bị "${name}"?`
    : `Are you sure you want to delete device "${name}"?`;
  if (!confirm(message)) return;

  try {
    const res = await fetch(`/api/devices/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) {
      showToast(data.message || (currentLang === 'vi' ? 'Không thể xóa thiết bị' : 'Failed to delete device'), 'error');
      return;
    }
    showToast(
      currentLang === 'vi'
        ? `Đã xóa thiết bị "${name}"`
        : `Device "${name}" deleted`,
      'success'
    );
    addActivityLog({
      deviceName: name,
      deviceType: dev?.type || 'device',
      action: currentLang === 'vi' ? 'Xóa thiết bị' : 'Delete device',
      actor: currentUser?.username || 'system',
      success: true,
    });
    pushActionNotification(
      currentLang === 'vi' ? 'Thiết bị đã xóa' : 'Device deleted',
      `${name}`,
      'warning'
    );
    incrementCommandCounter();
    await fetchDevices();
  } catch (e) {
    console.error(e);
    showToast('Server connection error', 'error');
  }
}

function navigate(page, navEl) {
  if (page === 'devices' && !state.selectedRoom) {
    showToast(
      currentLang === 'vi'
        ? 'Hãy chọn một khu vực trước để xem thiết bị.'
        : 'Please choose a room first to view devices.',
      'info'
    );
    page = 'rooms';
  }

  const pages = document.querySelectorAll('.page');
  pages.forEach(p => p.classList.remove('active'));
  const target = el(`page-${page}`);
  if (target) target.classList.add('active');

  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(n => n.classList.remove('active'));

  const breadcrumb = el('breadcrumbActive');
  if (breadcrumb) {
    const breadcrumbKeyMap = {
      dashboard: 'page_dashboard_title',
      rooms: 'page_rooms_title',
      devices: 'page_devices_title',
      scenes: 'page_scenes_title',
      schedules: 'page_schedules_title',
      notifications: 'page_notifications_title',
      mqtt: 'page_mqtt_title',
      history: 'page_history_title',
      users: 'page_users_title',
    };
    breadcrumb.textContent = t(breadcrumbKeyMap[page] || page);
  }

  // Mark active nav item
  if (navEl) {
    navEl.classList.add('active');
  } else {
    navItems.forEach(n => {
      const onclickAttr = n.getAttribute('onclick') || '';
      if (onclickAttr.includes(`navigate('${page}'`)) n.classList.add('active');
    });
  }

  if (page === 'rooms') renderRooms();
  if (page === 'devices') renderDevices();
  if (page === 'dashboard') renderDashboard();
  if (page === 'notifications') renderNotifications();
  if (page === 'mqtt') renderMqttConfig();
  if (page === 'history') loadHistory();
  if (page === 'users') fetchUsers();
  if (page === 'schedules') {
    syncScheduleDeviceSelect();
    renderScheduleList();
  }
}

function refreshNow() {
  fetchDevices().catch(() => showToast(currentLang === 'vi' ? 'Không thể tải lại dữ liệu thiết bị' : 'Failed to refresh device data', 'error'));
}

// Scenes
function sceneTitle(scene) {
  const key = String(scene?.name || '').toLowerCase();
  if (key === 'home') return t('scene_home_name');
  if (key === 'sleep') return t('scene_sleep_name');
  if (key === 'away') return t('scene_away_name');
  return scene?.name || (currentLang === 'vi' ? 'Scene' : 'Scene');
}

function sceneDescription(scene) {
  const key = String(scene?.name || '').toLowerCase();
  if (key === 'home') return t('scene_home_desc');
  if (key === 'sleep') return t('scene_sleep_desc');
  if (key === 'away') return t('scene_away_desc');
  if (Array.isArray(scene?.actions) && scene.actions.length) {
    return currentLang === 'vi'
      ? `${scene.actions.length} thiết bị được cấu hình`
      : `${scene.actions.length} configured devices`;
  }
  return scene?.description || '';
}

function sceneActionOptions(deviceType, selectedState = '') {
  const isDoor = deviceType === 'door';
  const options = isDoor
    ? [
        { value: 'OPEN', label: currentLang === 'vi' ? 'Mở' : 'Open' },
        { value: 'CLOSED', label: currentLang === 'vi' ? 'Đóng' : 'Closed' },
      ]
    : [
        { value: 'ON', label: currentLang === 'vi' ? 'Bật' : 'On' },
        { value: 'OFF', label: currentLang === 'vi' ? 'Tắt' : 'Off' },
      ];
  return options.map(opt => `<option value="${opt.value}" ${opt.value === selectedState ? 'selected' : ''}>${opt.label}</option>`).join('');
}

function renderSceneDeviceActions(selectedActions = []) {
  const wrap = el('sceneDeviceActions');
  if (!wrap) return;
  const deviceMap = new Map((selectedActions || []).map(action => [String(action.device_id || action.deviceId || ''), (action.target_state || action.targetState || '').toUpperCase()]));
  const devices = state.devices.filter(device => device.type === 'light' || device.type === 'door');
  if (!devices.length) {
    wrap.innerHTML = `<div style="color:var(--text3);font-size:12px">${currentLang === 'vi' ? 'Chưa có thiết bị đèn hoặc cửa để gán vào scene.' : 'No lights or doors available for this scene.'}</div>`;
    return;
  }
  wrap.innerHTML = devices.map(device => {
    const deviceId = String(device.id);
    const checked = deviceMap.has(deviceId);
    const selectedState = deviceMap.get(deviceId) || (device.type === 'door' ? 'CLOSED' : 'OFF');
    return `
      <div class="scene-device-row" onclick="toggleSceneActionRow(event, '${escapeHtml(deviceId)}')" style="display:grid;grid-template-columns:auto 1fr 120px;gap:10px;align-items:center;border:1px solid var(--border);background:var(--surface2);border-radius:12px;padding:10px 12px;cursor:pointer">
        <input type="checkbox" class="scene-device-check" data-device-id="${escapeHtml(deviceId)}" ${checked ? 'checked' : ''}/>
        <div>
          <div style="font-size:13px;font-weight:700">${escapeHtml(device.name)}</div>
          <div style="font-size:11px;color:var(--text3)">${escapeHtml(typeLabel(device.type))}</div>
        </div>
        <select class="form-input scene-device-target" data-device-id="${escapeHtml(deviceId)}" style="padding:7px 10px" onclick="event.stopPropagation()" onchange="handleSceneTargetChange('${escapeHtml(deviceId)}')">
          ${sceneActionOptions(device.type, selectedState)}
        </select>
      </div>
    `;
  }).join('');
}

function toggleSceneActionRow(event, deviceId) {
  if (event?.target?.closest('select')) return;
  const checkbox = document.querySelector(`#sceneDeviceActions .scene-device-check[data-device-id="${String(deviceId)}"]`);
  if (!checkbox) return;
  if (event?.target?.matches('input[type="checkbox"]')) return;
  checkbox.checked = !checkbox.checked;
}

function handleSceneTargetChange(deviceId) {
  const checkbox = document.querySelector(`#sceneDeviceActions .scene-device-check[data-device-id="${String(deviceId)}"]`);
  if (checkbox) checkbox.checked = true;
}

function collectSceneActions() {
  const checks = Array.from(document.querySelectorAll('#sceneDeviceActions .scene-device-check'));
  return checks
    .filter(node => node.checked)
    .map(node => {
      const deviceId = String(node.dataset.deviceId || '').trim();
      const select = document.querySelector(`#sceneDeviceActions .scene-device-target[data-device-id="${deviceId}"]`);
      return {
        deviceId,
        targetState: (select?.value || '').trim(),
      };
    })
    .filter(item => item.deviceId && item.targetState);
}

async function fetchScenes() {
  try {
    const res = await fetch('/api/scenes');
    const data = await res.json();
    state.scenes = Array.isArray(data) ? data : [];
    renderScenes();
    renderQuickScenes();
  } catch (e) {
    console.error(e);
    showToast(currentLang === 'vi' ? 'Không thể tải scene' : 'Failed to load scenes', 'error');
  }
}

function renderQuickScenes() {
  const wrap = el('quickScenesList');
  if (!wrap) return;
  const scenes = state.scenes.slice(0, 3);
  if (!scenes.length) {
    wrap.innerHTML = `<div style="color:var(--text3);font-size:12px;text-align:center">${currentLang === 'vi' ? 'Chưa có scene' : 'No scenes yet'}</div>`;
    return;
  }
  wrap.innerHTML = scenes.map(scene => `
    <button class="btn btn-secondary scene-quick-btn" onclick="activateScene(${Number(scene.id)})">
      ${escapeHtml(scene.icon || '🎬')} ${escapeHtml(sceneTitle(scene))}
    </button>
  `).join('');
}

function renderScenes() {
  // Scene là "macro" gồm nhiều hành động thiết bị; click card sẽ kích hoạt toàn scene.
  const grid = el('sceneGrid');
  if (!grid) return;
  if (!state.scenes.length) {
    grid.innerHTML = `<div class="card" style="grid-column:1/-1;text-align:center;color:var(--text3)">${currentLang === 'vi' ? 'Chưa có scene nào' : 'No scenes yet'}</div>`;
    return;
  }
  grid.innerHTML = state.scenes.map(scene => `
    <div class="scene-card" onclick="activateScene(${Number(scene.id)})">
      <span class="scene-emoji">${escapeHtml(scene.icon || '🎬')}</span>
      <div class="scene-name">${escapeHtml(sceneTitle(scene))}</div>
      <div class="scene-desc">${escapeHtml(sceneDescription(scene))}</div>
      <div class="scene-actions">
        <button class="btn btn-primary btn-sm" onclick="activateScene(${Number(scene.id)});event.stopPropagation()"><span aria-hidden="true">⚡</span> ${currentLang === 'vi' ? 'Kích hoạt' : 'Activate'}</button>
        <button class="btn btn-secondary btn-sm" onclick="openSceneModal(${Number(scene.id)});event.stopPropagation()">${currentLang === 'vi' ? 'Sửa' : 'Edit'}</button>
      </div>
    </div>
  `).join('');
}

function openSceneModal(sceneId = null) {
  editingSceneId = sceneId;
  const scene = state.scenes.find(item => Number(item.id) === Number(sceneId));
  if (el('sceneModalTitle')) el('sceneModalTitle').textContent = scene ? (currentLang === 'vi' ? 'Sửa scene' : 'Edit scene') : (currentLang === 'vi' ? 'Thêm scene' : 'Add scene');
  if (el('sceneName')) el('sceneName').value = scene?.name || '';
  if (el('sceneDescription')) el('sceneDescription').value = scene?.description || '';
  if (el('sceneIcon')) el('sceneIcon').value = scene?.icon || '🎬';
  renderSceneDeviceActions(scene?.actions || []);
  if (el('sceneDeleteBtn')) el('sceneDeleteBtn').style.display = scene ? 'inline-flex' : 'none';
  if (el('sceneSaveBtn')) el('sceneSaveBtn').textContent = currentLang === 'vi' ? 'Lưu scene' : 'Save scene';
  openModal('sceneModal');
}

async function saveScene() {
  const name = (el('sceneName')?.value || '').trim();
  const description = (el('sceneDescription')?.value || '').trim();
  const icon = (el('sceneIcon')?.value || '').trim() || '🎬';
  const actions = collectSceneActions();

  if (!name) {
    showToast(currentLang === 'vi' ? 'Vui lòng nhập tên scene' : 'Please enter scene name', 'warning');
    return;
  }
  if (!actions.length) {
    showToast(currentLang === 'vi' ? 'Vui lòng chọn ít nhất một thiết bị cho scene' : 'Please choose at least one device for the scene', 'warning');
    return;
  }

  const url = editingSceneId ? `/api/scenes/${editingSceneId}` : '/api/scenes';
  const method = editingSceneId ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        description,
        icon,
        actions,
        lightState: 'OFF',
        doorState: 'CLOSED',
      }),
    });
    const data = await res.json();
    if (!data.success) {
      showToast(data.message || (currentLang === 'vi' ? 'Không thể lưu scene' : 'Failed to save scene'), 'error');
      return;
    }
    closeModal('sceneModal');
    await fetchScenes();
    showToast(currentLang === 'vi' ? 'Đã lưu scene' : 'Scene saved', 'success');
  } catch (e) {
    console.error(e);
    showToast(currentLang === 'vi' ? 'Lỗi khi lưu scene' : 'Failed to save scene', 'error');
  }
}

async function deleteCurrentScene() {
  if (!editingSceneId) return;
  const scene = state.scenes.find(item => Number(item.id) === Number(editingSceneId));
  if (!confirm(currentLang === 'vi'
    ? `Xóa scene "${sceneTitle(scene)}"?`
    : `Delete scene "${sceneTitle(scene)}"?`)) {
    return;
  }
  try {
    const res = await fetch(`/api/scenes/${editingSceneId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) {
      showToast(data.message || (currentLang === 'vi' ? 'Không thể xóa scene' : 'Failed to delete scene'), 'error');
      return;
    }
    closeModal('sceneModal');
    editingSceneId = null;
    await fetchScenes();
    showToast(currentLang === 'vi' ? 'Đã xóa scene' : 'Scene deleted', 'success');
  } catch (e) {
    console.error(e);
    showToast(currentLang === 'vi' ? 'Lỗi khi xóa scene' : 'Failed to delete scene', 'error');
  }
}

function activateScene(sceneRef) {
  if (!state.devices.length) {
    return showToast(
      currentLang === 'vi' ? 'Chưa có thiết bị.' : 'No devices available.',
      'warning'
    );
  }

  const scene = typeof sceneRef === 'object'
    ? sceneRef
    : state.scenes.find(item => Number(item.id) === Number(sceneRef))
      || state.scenes.find(item => String(item.name).toLowerCase() === String(sceneRef).toLowerCase());
  if (!scene) {
    showToast(currentLang === 'vi' ? 'Không tìm thấy scene' : 'Scene not found', 'warning');
    return;
  }

  let changed = 0;
  if (Array.isArray(scene.actions) && scene.actions.length) {
    for (const action of scene.actions) {
      const dev = state.devices.find(item => String(item.id) === String(action.device_id || action.deviceId || ''));
      const desired = (action.target_state || action.targetState || '').toUpperCase();
      if (!dev || !desired) continue;
      if (dev.state !== desired) {
        changed += 1;
        toggleDevice(dev.id, desired);
      }
    }
  } else {
    const a = {
      light: scene.light_state || 'OFF',
      door: scene.door_state || 'CLOSED',
    };
    for (const dev of state.devices) {
      const desired = dev.type === 'light' ? a.light : dev.type === 'door' ? a.door : null;
      if (!desired) continue;
      if (dev.state !== desired) {
        changed += 1;
        toggleDevice(dev.id, desired);
      }
    }
  }

  const sceneName = sceneTitle(scene);
  const commandsWord = t('toast_commands_word');
  const actionWord = currentLang === 'vi' ? 'đã kích hoạt' : 'activated';
  showToast(`${t('toast_scene_activated_prefix')} "${sceneName}" ${actionWord} (${changed} ${commandsWord})`, 'success');
  addActivityLog({
    deviceName: `${currentLang === 'vi' ? 'Scene' : 'Scene'}: ${sceneName}`,
    deviceType: 'scene',
    action: 'Activated',
    actor: currentUser?.username || 'system',
    success: true,
  });
  incrementCommandCounter(Math.max(changed, 1));
}

function nowTimeText() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function activityActionLabel(type, action) {
  if (type === 'light') {
    if (action === 'ON') return 'Turned on';
    if (action === 'OFF') return 'Turned off';
  }
  if (type === 'door') {
    if (action === 'OPEN') return 'Opened';
    if (action === 'CLOSED') return 'Closed';
  }
  return action;
}

function activityIcon(type) {
  if (type === 'light') return '💡';
  if (type === 'door') return '🚪';
  if (type === 'scene') return '🎬';
  if (type === 'sensor_temperature') return '🌡️';
  if (type === 'sensor_humidity') return '💧';
  if (type === 'sensor') return '📟';
  if (type === 'curtain') return '🪟';
  if (type === 'fan') return '🌀';
  if (type === 'aircon') return '❄️';
  return '📦';
}

function addActivityLog({ deviceName, deviceType, action, actor, success }) {
  const item = {
    time: nowTimeText(),
    deviceName: deviceName || 'Unknown',
    deviceType: deviceType || 'device',
    action: activityActionLabel(deviceType, action),
    actor: actor || 'system',
    success: !!success,
  };
  state.activityLogs.unshift(item);
  if (state.activityLogs.length > 8) state.activityLogs.length = 8;
  renderActivityTable();
}

function renderActivityTable() {
  const tbody = el('activityTableBody');
  if (!tbody) return;
  if (!state.activityLogs.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text3)">No recent activity</td></tr>`;
    return;
  }
  tbody.innerHTML = state.activityLogs.map((row) => `
    <tr>
      <td class="td-mono">${escapeHtml(row.time)}</td>
      <td>
        <div class="activity-device">
          <div class="activity-icon">${activityIcon(row.deviceType)}</div>
          <div>
            <div class="activity-name">${escapeHtml(row.deviceName)}</div>
            <div class="activity-sub">${escapeHtml(typeLabel(row.deviceType))}</div>
          </div>
        </div>
      </td>
      <td>${escapeHtml(row.action)}</td>
      <td>${escapeHtml(row.actor)}</td>
      <td>${row.success
        ? `<span class="badge badge-online"> Success</span>`
        : `<span class="badge badge-danger"> Error</span>`}
      </td>
    </tr>
  `).join('');
}

function syncRoomFilterSelect() {
  const sel = el('filterRoom');
  if (!sel) return;
  const current = state.selectedRoom;
  const rooms = getRoomsSummary().map(r => r.room);
  const first = 'All rooms';
  sel.innerHTML = `<option value="">${first}</option>` + rooms.map(r => `<option value="${r}">${getRoomText(r)}</option>`).join('');
  if ([...sel.options].some(o => o.value === current)) sel.value = current;
}

function syncNewDeviceRoomSelect() {
  const sel = el('newDevRoom');
  if (!sel) return;
  const rooms = getRoomsSummary().map(r => r.room);
  if (!rooms.length) {
    sel.innerHTML = `<option value="">${currentLang === 'vi' ? 'Chưa có khu vực' : 'No rooms'}</option>`;
    return;
  }
  sel.innerHTML = rooms
    .map(room => `<option value="${escapeHtml(room)}">${escapeHtml(getRoomText(room))}</option>`)
    .join('');
}

function openRoomDevices(room) {
  state.selectedRoom = room;
  const roomSel = el('filterRoom');
  if (roomSel) roomSel.value = room;
  navigate('devices');
}

function renderRooms() {
  const grid = el('roomsGrid');
  const subtitle = el('roomsSubtitle');
  if (!grid || !subtitle) return;

  const rooms = getRoomsSummary();
  const totalDevices = rooms.reduce((s, r) => s + r.total, 0);
  subtitle.textContent = currentLang === 'vi'
    ? `${rooms.length} khu vực - ${totalDevices} thiết bị`
    : `${rooms.length} rooms - ${totalDevices} devices`;

  if (!rooms.length) {
    grid.innerHTML = `<div class="card" style="grid-column:1/-1;text-align:center;color:var(--text3)">${currentLang === 'vi' ? 'Chưa có khu vực' : 'No rooms yet'}</div>`;
    return;
  }

  grid.innerHTML = rooms.map(r => `
    <div class="room-card" onclick="openRoomDevices('${r.room}')">
      <div class="room-card-top">
        <div class="room-header">
          <div class="room-icon">${r.icon || roomIcon(r.room)}</div>
          <div style="min-width:0">
            <div class="room-name">${getRoomText(r.room)}</div>
            <div class="room-sub">
              ${r.total} ${currentLang === 'vi' ? 'thiết bị' : 'devices'}
              ${r.floorLabel ? ` • ${escapeHtml(r.floorLabel)}` : ''}
            </div>
          </div>
        </div>
        <button class="btn btn-secondary room-delete-btn" onclick="deleteRoom(event, ${Number(r.id || 0)}, '${escapeHtml(r.room)}')">${currentLang === 'vi' ? 'Xóa' : 'Delete'}</button>
      </div>
      <div class="room-stats">
        <div class="room-stat"><span class="room-dot online"></span> ${r.online} ${currentLang === 'vi' ? 'online' : 'online'}</div>
        <div class="room-stat"><span class="room-dot offline"></span> ${r.offline} ${currentLang === 'vi' ? 'offline' : 'offline'}</div>
      </div>
      <div class="room-device-icons">${r.icons.slice(0, 10).map(i => `<span class="room-device-chip">${i}</span>`).join('')}</div>
    </div>
  `).join('');
}

function openAddRoom() {
  const nameInput = el('roomName');
  const floorInput = el('roomFloor');
  const iconInput = el('roomIconInput');
  if (nameInput) nameInput.value = '';
  if (floorInput) floorInput.value = 'Tầng 1';
  if (iconInput) iconInput.value = '🏠';
  openModal('addRoomModal');
}

async function saveRoom() {
  const name = (el('roomName')?.value || '').trim();
  const floorLabel = (el('roomFloor')?.value || '').trim();
  const icon = (el('roomIconInput')?.value || '').trim();

  if (!name) {
    showToast(currentLang === 'vi' ? 'Vui lòng nhập tên khu vực' : 'Please enter room name', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, floorLabel, icon }),
    });
    const data = await res.json();
    if (!data.success) {
      showToast(data.message || (currentLang === 'vi' ? 'Không thể thêm khu vực' : 'Failed to add room'), 'error');
      return;
    }
    closeModal('addRoomModal');
    showToast(currentLang === 'vi' ? 'Đã thêm khu vực mới' : 'Room added', 'success');
    await fetchRooms();
    renderRooms();
    syncRoomFilterSelect();
    syncNewDeviceRoomSelect();
  } catch (e) {
    console.error(e);
    showToast(currentLang === 'vi' ? 'Lỗi kết nối máy chủ' : 'Server connection error', 'error');
  }
}

async function deleteRoom(event, roomId, roomName) {
  if (event) event.stopPropagation();
  if (!roomId) return;

  const ok = confirm(
    currentLang === 'vi'
      ? `Bạn có chắc muốn xóa khu vực "${roomName}"?`
      : `Are you sure you want to delete room "${roomName}"?`
  );
  if (!ok) return;

  try {
    const res = await fetch(`/api/rooms/${roomId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) {
      showToast(data.message || (currentLang === 'vi' ? 'Không thể xóa khu vực' : 'Failed to delete room'), 'error');
      return;
    }
    if (state.selectedRoom === roomName) state.selectedRoom = '';
    showToast(currentLang === 'vi' ? 'Đã xóa khu vực' : 'Room deleted', 'success');
    await fetchRooms();
    await fetchDevices();
  } catch (e) {
    console.error(e);
    showToast(currentLang === 'vi' ? 'Lỗi kết nối máy chủ' : 'Server connection error', 'error');
  }
}

function incrementCommandCounter(n = 1) {
  const hour = new Date().getHours();
  state.commandHistory24h[hour] += n;
  renderCommandChart();
}

function renderCommandChart() {
  const barsEl = el('commandChartBars');
  const labelsEl = el('commandChartLabels');
  const totalEl = el('commandChartTotal');
  if (!barsEl || !labelsEl || !totalEl) return;

  const data = state.commandHistory24h;
  const max = Math.max(...data, 1);
  const nowHour = new Date().getHours();
  const total = data.reduce((a, b) => a + b, 0);
  totalEl.textContent = `Total: ${total} commands`;

  barsEl.innerHTML = data.map((v, i) => `
    <div
      class="chart-bar ${i === nowHour ? 'highlight' : ''}"
      style="height:${Math.max(6, Math.round((v / max) * 100))}%"
      title="${v} commands @ ${String(i).padStart(2, '0')}h">
    </div>
  `).join('');

  labelsEl.innerHTML = Array.from({ length: 24 }, (_, i) => `
    <span class="chart-label">${i % 4 === 0 ? `${String(i).padStart(2, '0')}h` : ''}</span>
  `).join('');
}

async function loadNotifications() {
  // Notification được tải theo user hiện tại để hỗ trợ private/broadcast message.
  try {
    const username = currentUser?.username || '';
    const role = currentUser?.role || 'user';
    const res = await fetch(`/api/notifications?username=${encodeURIComponent(username)}&role=${encodeURIComponent(role)}`);
    const rows = await res.json();
    state.notifications = Array.isArray(rows) ? rows : [];
  } catch {
    state.notifications = [];
  }
  renderNotifications();
}

function upsertNotification(n) {
  const id = n.id;
  if (!id) return;
  const idx = state.notifications.findIndex(x => String(x.id) === String(id));
  if (idx >= 0) state.notifications[idx] = n;
  else state.notifications.unshift(n);
  if (state.notifications.length > 200) state.notifications.length = 200;
}

async function pushSystemNotification({ type = 'info', title, message, sender = 'system', audience = 'private', targetUser = null }) {
  try {
    const res = await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, title, message, sender, audience, targetUser }),
    });
    const data = await res.json();
    if (data?.notification) {
      upsertNotification(data.notification);
      renderNotifications();
    }
  } catch (e) {
    console.error('pushSystemNotification error:', e);
  }
}

async function pushActionNotification(title, message, type = 'info') {
  // Chặn spam notification liên tiếp khi user thao tác quá nhanh.
  const now = Date.now();
  if (now - lastActionNotifAt < 700) return;
  lastActionNotifAt = now;
  await pushSystemNotification({
    type,
    title,
    message,
    sender: currentUser?.username || 'system',
    audience: 'private',
    targetUser: currentUser?.username || null,
  });
}

function formatTimeIso(iso) {
  const d = new Date(iso);
  return d.toLocaleString(currentLang === 'vi' ? 'vi-VN' : 'en-US');
}

function updateNotifBadge() {
  const unread = state.notifications.filter(n => !(n.is_read || n.read)).length;
  const badge = el('notifBadge');
  if (!badge) return;
  if (unread > 0) {
    badge.style.display = 'inline-flex';
    badge.textContent = String(unread > 99 ? '99+' : unread);
  } else {
    badge.style.display = 'none';
  }
}

async function markNotificationRead(id) {
  const n = state.notifications.find(x => String(x.id) === String(id));
  if (!n) return;
  n.is_read = 1;
  renderNotifications();
  try {
    const username = currentUser?.username || '';
    const role = currentUser?.role || 'user';
    await fetch(`/api/notifications/${id}/read?username=${encodeURIComponent(username)}&role=${encodeURIComponent(role)}`, { method: 'PUT' });
  } catch (e) {
    console.error('markNotificationRead error:', e);
  }
}

async function markAllNotificationsRead() {
  const unreadItems = state.notifications.filter(n => !(n.is_read || n.read));
  if (!unreadItems.length) return;

  unreadItems.forEach(n => {
    n.is_read = 1;
  });
  renderNotifications();

  try {
    const username = currentUser?.username || '';
    const role = currentUser?.role || 'user';
    await fetch(`/api/notifications/read-all?username=${encodeURIComponent(username)}&role=${encodeURIComponent(role)}`, { method: 'PUT' });
  } catch (e) {
    console.error('markAllNotificationsRead error:', e);
  }
}

function renderNotifications() {
  // Vừa render danh sách, vừa cập nhật badge unread và quyền admin broadcast.
  const list = el('notifList');
  const subtitle = el('notificationsSubtitle');
  const adminCard = el('adminNotifyCard');
  const markAllBtn = el('btnMarkAllRead');
  if (!list || !subtitle) return;

  const unread = state.notifications.filter(n => !(n.is_read || n.read)).length;
  subtitle.textContent = currentLang === 'vi'
    ? `${unread} chưa đọc - ${state.notifications.length} tổng`
    : `${unread} unread - ${state.notifications.length} total`;

  if (markAllBtn) {
    markAllBtn.disabled = unread === 0;
    markAllBtn.style.opacity = unread === 0 ? '0.55' : '1';
    markAllBtn.style.cursor = unread === 0 ? 'default' : 'pointer';
  }

  if (adminCard) {
    const isAdmin = !!currentUser && (currentUser.role || '').toLowerCase() === 'admin';
    adminCard.style.display = isAdmin ? 'block' : 'none';
  }

  if (!state.notifications.length) {
    list.innerHTML = `<div class="card" style="text-align:center;color:var(--text3)">${currentLang === 'vi' ? 'Chưa có thông báo' : 'No notifications yet'}</div>`;
    updateNotifBadge();
    return;
  }

  list.innerHTML = state.notifications.map(n => `
    <div class="notif-item ${n.type}" style="${(n.is_read || n.read) ? 'opacity:0.6' : ''}">
      <div class="notif-icon">${n.type === 'error' ? '' : n.type === 'warning' ? '' : n.type === 'success' ? '' : ''}</div>
      <div style="flex:1">
        <div class="notif-title">${escapeHtml(n.title)}</div>
        <div class="notif-msg">${escapeHtml(n.message)}</div>
        <div class="notif-time">${escapeHtml(formatTimeIso(n.created_at || n.time))}  ${escapeHtml(n.sender || 'system')}</div>
      </div>
      ${!(n.is_read || n.read) ? `<button class="btn btn-secondary btn-sm" onclick="markNotificationRead('${n.id}')"></button>` : ''}
    </div>
  `).join('');
  updateNotifBadge();
}

async function sendAdminNotification() {
  const title = (el('notifyTitle')?.value || '').trim();
  const message = (el('notifyMessage')?.value || '').trim();
  if (!title || !message) {
    showToast(currentLang === 'vi' ? 'Vui lòng nhập tiêu đề và nội dung' : 'Please fill title and message', 'warning');
    return;
  }
  await pushSystemNotification({
    type: 'info',
    title,
    message,
    sender: currentUser?.username || 'admin',
    audience: 'all',
  });
  if (el('notifyTitle')) el('notifyTitle').value = '';
  if (el('notifyMessage')) el('notifyMessage').value = '';
  showToast(currentLang === 'vi' ? 'Đã gửi thông báo cho người dùng' : 'Notification sent to users', 'success');
}

async function loadMqttConfig() {
  const defaults = {
    host: 'emqx.local',
    port: '1883',
    username: 'backend_service',
    password: '',
    clientId: 'smarthome-backend-01',
    keepAlive: '60',
    status: 'connected',
  };
  try {
    const res = await fetch('/api/mqtt-config');
    const row = await res.json();
    state.mqttConfig = {
      ...defaults,
      host: row.host ?? defaults.host,
      port: String(row.port ?? defaults.port),
      username: row.username ?? defaults.username,
      password: row.password ?? defaults.password,
      clientId: row.client_id ?? defaults.clientId,
      keepAlive: String(row.keep_alive ?? defaults.keepAlive),
      status: 'connected',
    };
  } catch {
    state.mqttConfig = defaults;
  }
  renderMqttConfig();
}

function renderMqttConfig() {
  if (!state.mqttConfig) return;
  const c = state.mqttConfig;
  if (el('mqttHost')) el('mqttHost').value = c.host || '';
  if (el('mqttPort')) el('mqttPort').value = c.port || '';
  if (el('mqttUser')) el('mqttUser').value = c.username || '';
  if (el('mqttPass')) el('mqttPass').value = c.password || '';
  if (el('mqttClientId')) el('mqttClientId').value = c.clientId || '';
  if (el('mqttKeepAlive')) el('mqttKeepAlive').value = c.keepAlive || '';
  if (el('mqttStatusLabel')) {
    el('mqttStatusLabel').textContent = c.status === 'connected'
      ? (currentLang === 'vi' ? 'Đã kết nối' : 'Connected')
      : (currentLang === 'vi' ? 'Mất kết nối' : 'Disconnected');
  }
}

async function saveMqttConfig() {
  state.mqttConfig = {
    host: (el('mqttHost')?.value || '').trim(),
    port: (el('mqttPort')?.value || '').trim(),
    username: (el('mqttUser')?.value || '').trim(),
    password: (el('mqttPass')?.value || '').trim(),
    clientId: (el('mqttClientId')?.value || '').trim(),
    keepAlive: (el('mqttKeepAlive')?.value || '').trim(),
    status: 'connected',
  };
  try {
    const res = await fetch('/api/mqtt-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.mqttConfig),
    });
    const data = await res.json();
    if (!data.success) {
      showToast(data.message || (currentLang === 'vi' ? 'Không thể lưu cấu hình MQTT' : 'Failed to save MQTT config'), 'error');
      return;
    }
    renderMqttConfig();
    showToast(currentLang === 'vi' ? 'Đã lưu cấu hình MQTT' : 'MQTT config saved', 'success');
  } catch (e) {
    console.error(e);
    showToast(currentLang === 'vi' ? 'Lỗi kết nối máy chủ' : 'Server connection error', 'error');
  }
}

async function testMqttConfig() {
  const payload = {
    host: (el('mqttHost')?.value || '').trim(),
    port: (el('mqttPort')?.value || '').trim(),
  };
  try {
    const res = await fetch('/api/mqtt-config/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    const ok = !!data.success;
    state.mqttConfig = state.mqttConfig || {};
    state.mqttConfig.status = ok ? 'connected' : 'disconnected';
    renderMqttConfig();
    showToast(
      ok
        ? (currentLang === 'vi' ? 'Kết nối MQTT thành công' : 'MQTT connection success')
        : (data.message || (currentLang === 'vi' ? 'Kết nối MQTT thất bại' : 'MQTT connection failed')),
      ok ? 'success' : 'error'
    );
  } catch (e) {
    console.error(e);
    showToast(currentLang === 'vi' ? 'Lỗi kết nối máy chủ' : 'Server connection error', 'error');
  }
}

function startMqttStatsTicker() {
  setInterval(() => {
    const c = el('mqttStatConnections');
    const m = el('mqttStatMps');
    const s = el('mqttStatSubs');
    const r = el('mqttStatRetained');
    if (!c || !m || !s || !r) return;
    c.textContent = String(30 + Math.floor(Math.random() * 30));
    m.textContent = String(8 + Math.floor(Math.random() * 20));
    s.textContent = String(120 + Math.floor(Math.random() * 120));
    r.textContent = String(20 + Math.floor(Math.random() * 80));
  }, 4000);
}

function initDashboardExtras() {
  if (state.activityLogs.length === 0) {
    state.activityLogs = [
      {
        time: nowTimeText(),
        deviceName: 'SmartHome System',
        deviceType: 'scene',
        action: 'Ready',
        actor: 'System',
        success: true,
      },
    ];
  }

  const hasChartData = state.commandHistory24h.some(v => v > 0);
  if (!hasChartData) {
    // Seed demo-like chart so dashboard does not look empty.
    state.commandHistory24h = Array.from({ length: 24 }, (_, i) => {
      const base = i >= 6 && i <= 22 ? 2 : 0;
      return base + Math.floor(Math.random() * 6);
    });
  }
}

// History
function buildHistoryQueryParams(extraParams = {}) {
  // Gom logic build query ở một chỗ để load JSON và export CSV dùng chung.
  const params = new URLSearchParams();
  const dateValue = (el('historyDate')?.value || '').trim();
  const fromTime = (el('historyFromTime')?.value || '').trim();
  const toTime = (el('historyToTime')?.value || '').trim();
  const sensorType = (el('historySensorType')?.value || '').trim();

  if (historyAbsoluteRange?.fromDateTime) params.set('fromDateTime', historyAbsoluteRange.fromDateTime);
  if (historyAbsoluteRange?.toDateTime) params.set('toDateTime', historyAbsoluteRange.toDateTime);
  if (dateValue && !historyAbsoluteRange) params.set('date', dateValue);
  if (fromTime && !historyAbsoluteRange) params.set('fromTime', fromTime);
  if (toTime && !historyAbsoluteRange) params.set('toTime', toTime);
  if (sensorType) params.set('sensorType', sensorType);

  Object.entries(extraParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
  });

  return params;
}

async function loadHistory() {
  // Tải lịch sử cảm biến theo filter hiện tại rồi đổ vào bảng.
  const tbody = el('historyTableBody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:28px;color:var(--text3)">${escapeHtml(t('toast_history_loading'))}</td></tr>`;
  try {
    const params = buildHistoryQueryParams();
    const query = params.toString();
    const res = await fetch(query ? `/api/history?${query}` : '/api/history');
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:28px;color:var(--text3)">${escapeHtml(t('toast_history_empty'))}</td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(row => {
      const sensorType = row.sensor_type;
      let label = sensorType;
      let valueText = row.value;
      if (sensorType === 'temperature') { label = currentLang === 'vi' ? 'Nhiệt độ' : 'Temperature'; valueText = `${row.value}C`; }
      if (sensorType === 'humidity') { label = currentLang === 'vi' ? 'Độ ẩm' : 'Humidity'; valueText = `${row.value}%`; }
      if (sensorType === 'gas') { label = 'Gas'; valueText = `${row.value}`; }

      const dateObj = row.timestamp ? new Date(row.timestamp) : null;
      const timeText = dateObj ? dateObj.toLocaleString(currentLang === 'vi' ? 'vi-VN' : 'en-US') : '';

      return `
        <tr>
          <td class="td-mono">#${row.id}</td>
          <td>${escapeHtml(label)}</td>
          <td style="color:var(--primary);font-weight:900">${escapeHtml(valueText)}</td>
          <td style="color:var(--text2)">${escapeHtml(timeText)}</td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    console.error(e);
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:28px;color:var(--danger);font-weight:800">${escapeHtml(t('toast_history_error'))}</td></tr>`;
  }
}

function resetHistoryFilters() {
  historyAbsoluteRange = null;
  if (el('historyDate')) el('historyDate').value = '';
  if (el('historyFromTime')) el('historyFromTime').value = '';
  if (el('historyToTime')) el('historyToTime').value = '';
  if (el('historySensorType')) el('historySensorType').value = '';
  loadHistory();
}

function applyHistoryQuickRange(mode) {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const toLocalDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const toLocalTime = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const toIsoLocal = (date) => `${toLocalDate(date)} ${toLocalTime(date)}:00`;

  if (mode === 'today') {
    historyAbsoluteRange = null;
    if (el('historyDate')) el('historyDate').value = toLocalDate(now);
    if (el('historyFromTime')) el('historyFromTime').value = '00:00';
    if (el('historyToTime')) el('historyToTime').value = toLocalTime(now);
  } else if (mode === 'lastHour') {
    const from = new Date(now.getTime() - 60 * 60 * 1000);
    historyAbsoluteRange = {
      fromDateTime: toIsoLocal(from),
      toDateTime: toIsoLocal(now),
    };
    if (el('historyDate')) el('historyDate').value = '';
    if (el('historyFromTime')) el('historyFromTime').value = '';
    if (el('historyToTime')) el('historyToTime').value = '';
  } else if (mode === 'last24Hours') {
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    historyAbsoluteRange = {
      fromDateTime: toIsoLocal(from),
      toDateTime: toIsoLocal(now),
    };
    if (el('historyDate')) el('historyDate').value = '';
    if (el('historyFromTime')) el('historyFromTime').value = '';
    if (el('historyToTime')) el('historyToTime').value = '';
  }

  loadHistory();
}

function exportHistoryCsv() {
  const params = buildHistoryQueryParams({ format: 'csv' });
  const query = params.toString();
  window.location.href = query ? `/api/history?${query}` : '/api/history?format=csv';
}

function setupHistoryFilters() {
  ['historyDate', 'historyFromTime', 'historyToTime'].forEach(id => {
    const node = el(id);
    if (!node) return;
    node.addEventListener('change', () => {
      historyAbsoluteRange = null;
    });
  });
}

// Users
function getRoleBadge(role) {
  const value = (role || 'user').toLowerCase();
  const map = {
    admin: { label: 'Admin', style: 'background:rgba(255,94,98,.12);color:#ff6b6b;border:1px solid rgba(255,94,98,.2)' },
    operator: { label: currentLang === 'vi' ? 'Điều hành' : 'Operator', style: 'background:rgba(255,176,32,.12);color:#ffb020;border:1px solid rgba(255,176,32,.18)' },
    viewer: { label: currentLang === 'vi' ? 'Xem' : 'Viewer', style: 'background:rgba(74,144,226,.12);color:#4a90e2;border:1px solid rgba(74,144,226,.18)' },
    user: { label: currentLang === 'vi' ? 'Người dùng' : 'User', style: 'background:rgba(120,130,160,.12);color:var(--text2);border:1px solid rgba(120,130,160,.16)' },
  };
  return map[value] || map.user;
}

function getStatusBadge(isActive) {
  return Number(isActive) === 1
    ? { label: currentLang === 'vi' ? 'Hoạt động' : 'Active', style: 'background:rgba(16,185,129,.12);color:#34d399;border:1px solid rgba(16,185,129,.18)' }
    : { label: currentLang === 'vi' ? 'Ngưng hoạt động' : 'Inactive', style: 'background:rgba(120,130,160,.12);color:var(--text3);border:1px solid rgba(120,130,160,.16)' };
}

function formatLastLogin(lastLogin) {
  if (!lastLogin) return currentLang === 'vi' ? 'Chưa đăng nhập' : 'Never';
  const value = new Date(lastLogin);
  if (Number.isNaN(value.getTime())) return '-';

  const diffMs = Date.now() - value.getTime();
  const diffMin = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMin < 1) return currentLang === 'vi' ? 'Vừa xong' : 'Just now';
  if (diffMin < 60) return currentLang === 'vi' ? `${diffMin} phút trước` : `${diffMin} min ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return currentLang === 'vi' ? `${diffHour} giờ trước` : `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return currentLang === 'vi' ? `${diffDay} ngày trước` : `${diffDay}d ago`;
  return value.toLocaleString(currentLang === 'vi' ? 'vi-VN' : 'en-US');
}

function updateUsersSummary() {
  const summary = el('usersSummary');
  const addBtn = el('usersAddBtn');
  const isAdmin = (currentUser?.role || '').toLowerCase() === 'admin';
  if (addBtn) addBtn.style.display = isAdmin ? 'inline-flex' : 'none';
  if (!summary) return;
  summary.textContent = currentLang === 'vi'
    ? `${state.users.length} tài khoản - phân quyền theo vai trò`
    : `${state.users.length} accounts - role-based access`;
}

function renderUsersTable(users) {
  const container = el('usersContainer');
  if (!container) return;

  container.innerHTML = `
    <div style="overflow:auto">
      <div style="min-width:860px">
        <div style="display:grid;grid-template-columns:2.2fr 1fr 1fr 1.2fr .8fr;gap:16px;padding:16px 18px;border-bottom:1px solid var(--border);color:var(--text2);font-weight:900;text-transform:uppercase;letter-spacing:.04em">
          <div>${currentLang === 'vi' ? 'Người dùng' : 'User'}</div>
          <div>${currentLang === 'vi' ? 'Vai trò' : 'Role'}</div>
          <div>${currentLang === 'vi' ? 'Trạng thái' : 'Status'}</div>
          <div>${currentLang === 'vi' ? 'Đăng nhập cuối' : 'Last login'}</div>
          <div>${currentLang === 'vi' ? 'Thao tác' : 'Actions'}</div>
        </div>
        ${users.map(u => {
          const roleBadge = getRoleBadge(u.role);
          const statusBadge = getStatusBadge(u.is_active);
          const uname = u.username || '';
          const isSelf = uname === (currentUser?.username || '');
          const marker = isSelf ? `<div style="font-size:12px;color:var(--text3);margin-top:4px">${currentLang === 'vi' ? 'Tài khoản hiện tại' : 'Current account'}</div>` : '';
          return `
            <div style="display:grid;grid-template-columns:2.2fr 1fr 1fr 1.2fr .8fr;gap:16px;align-items:center;padding:18px;border-bottom:1px solid rgba(255,255,255,.04)">
              <div style="display:flex;align-items:center;gap:14px;min-width:0">
                <div class="user-avatar" style="width:48px;height:48px;font-size:18px;background:${(u.role || '').toLowerCase() === 'admin' ? 'linear-gradient(135deg,#7c4dff,#5a67ff)' : 'linear-gradient(135deg,#29c7b8,#3b82f6)'}">${escapeHtml(uname.charAt(0).toUpperCase())}</div>
                <div style="min-width:0">
                  <div style="font-size:15px;font-weight:900;color:var(--text1)">${escapeHtml(uname)}</div>
                  <div style="font-size:13px;color:var(--text3);margin-top:4px">${escapeHtml(u.email || `${uname}@smarthome.vn`)}</div>
                  ${marker}
                </div>
              </div>
              <div><span style="display:inline-flex;align-items:center;justify-content:center;padding:7px 14px;border-radius:999px;font-size:12px;font-weight:900;${roleBadge.style}">${escapeHtml(roleBadge.label)}</span></div>
              <div><span style="display:inline-flex;align-items:center;gap:8px;padding:7px 14px;border-radius:999px;font-size:12px;font-weight:900;${statusBadge.style}"><span style="width:8px;height:8px;border-radius:50%;background:currentColor"></span>${escapeHtml(statusBadge.label)}</span></div>
              <div style="font-size:14px;color:var(--text2)">${escapeHtml(formatLastLogin(u.last_login))}</div>
              <div><button class="btn btn-secondary btn-sm" onclick="openUserModal(${u.id})">${currentLang === 'vi' ? 'Sửa' : 'Edit'}</button></div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function openUserModal(userId = null) {
  if (!currentUser || (currentUser.role || '').toLowerCase() !== 'admin') return;

  editingUserId = userId;
  const user = state.users.find(item => item.id === userId) || null;
  const isRootAdmin = (user?.username || '').toLowerCase() === 'admin';
  const isSelf = (user?.username || '') === (currentUser?.username || '');

  if (el('userModalTitle')) {
    el('userModalTitle').textContent = user
      ? (currentLang === 'vi' ? 'Sửa người dùng' : 'Edit user')
      : (currentLang === 'vi' ? 'Thêm người dùng' : 'Add user');
  }
  if (el('userFormUsername')) el('userFormUsername').value = user?.username || '';
  if (el('userFormEmail')) el('userFormEmail').value = user?.email || '';
  if (el('userFormRole')) el('userFormRole').value = (user?.role || 'user').toLowerCase();
  if (el('userFormActive')) el('userFormActive').value = Number(user?.is_active) === 1 ? '1' : '0';
  if (el('userFormPassword')) el('userFormPassword').value = '';

  if (el('userFormUsername')) el('userFormUsername').disabled = isRootAdmin;
  if (el('userFormRole')) el('userFormRole').disabled = isRootAdmin || isSelf;
  if (el('userFormActive')) el('userFormActive').disabled = isRootAdmin || isSelf;

  const deleteBtn = el('userDeleteBtn');
  if (deleteBtn) deleteBtn.style.display = user && !isRootAdmin && !isSelf ? 'inline-flex' : 'none';

  openModal('userModal');
}

async function fetchUsers() {
  const container = el('usersContainer');
  if (!container) return;

  updateUsersSummary();

  if (!currentUser || (currentUser.role || '').toLowerCase() !== 'admin') {
    container.innerHTML = `<div style="color:var(--text3);padding:18px 0;text-align:center;font-weight:900">${escapeHtml(t('users_only_admin'))}</div>`;
    return;
  }

  container.innerHTML = `<div style="color:var(--text3);padding:18px 0;text-align:center;font-weight:900">${escapeHtml(t('users_loading'))}</div>`;

  try {
    const res = await fetch('/api/users');
    const users = await res.json();
    state.users = Array.isArray(users) ? users : [];
    updateUsersSummary();

    if (state.users.length === 0) {
      container.innerHTML = `<div style="color:var(--text3);padding:18px 0;text-align:center;font-weight:900">${escapeHtml(t('users_empty'))}</div>`;
      return;
    }

    renderUsersTable(state.users);
  } catch (e) {
    console.error(e);
    container.innerHTML = `<div style="color:var(--danger);padding:18px 0;text-align:center;font-weight:900">Failed to load users</div>`;
  }
}

async function saveUser() {
  const username = (el('userFormUsername')?.value || '').trim();
  const email = (el('userFormEmail')?.value || '').trim();
  const role = (el('userFormRole')?.value || 'user').trim().toLowerCase();
  const password = (el('userFormPassword')?.value || '').trim();
  const isActive = (el('userFormActive')?.value || '1') === '1';

  if (!username) {
    showToast('Please enter username', 'warning');
    return;
  }
  if (!editingUserId && !password) {
    showToast('Please enter password for new user', 'warning');
    return;
  }

  try {
    const res = await fetch(editingUserId ? `/api/users/${editingUserId}` : '/api/users', {
      method: editingUserId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, role, password, isActive }),
    });
    const data = await res.json();
    if (!data.success) {
      showToast(data.message || 'Failed to save user', 'error');
      return;
    }

    closeModal('userModal');
    showToast(data.message || 'User saved', 'success');
    await fetchUsers();
  } catch (e) {
    console.error(e);
    showToast('Connection error', 'error');
  }
}

async function changeUserRole(userId, newRole) {
  if (!confirm('Confirm role change?')) return;
  try {
    const res = await fetch(`/api/users/${userId}/role`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    });
    const data = await res.json();
    if (!data.success) showToast(data.message || 'Failed to update', 'error');
    else showToast('Role updated!', 'success');
    fetchUsers();
  } catch (e) {
    console.error(e);
    showToast('Connection error', 'error');
  }
}

async function deleteUser(userId) {
  if (!confirm('Are you sure you want to delete this user?')) return;
  try {
    const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) showToast(data.message || 'Failed to delete', 'error');
    else {
      closeModal('userModal');
      showToast('User deleted!', 'success');
    }
    fetchUsers();
  } catch (e) {
    console.error(e);
    showToast('Connection error', 'error');
  }
}

function deleteCurrentEditingUser() {
  if (!editingUserId) return;
  deleteUser(editingUserId);
}

// Add device
function openAddDevice() {
  openModal('addDeviceModal');
  const input = el('newDevName');
  if (input) input.value = '';
  syncNewDeviceRoomSelect();
}

async function saveDevice() {
  const name = (el('newDevName')?.value || '').trim();
  const roomName = (el('newDevRoom')?.value || '').trim();
  const type = el('newDevType')?.value || 'light';
  if (!name) return showToast('Please enter a device name', 'warning');

  try {
    const res = await fetch('/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, roomName }),
    });
    const data = await res.json();
    if (!data.success) {
      showToast('Failed to add device', 'error');
      return;
    }
    closeModal('addDeviceModal');
    showToast(`Device "${name}" added`, 'success');
    pushActionNotification(
      'New device',
      `${name} (${type})${roomName ? ` - ${roomName}` : ''}`,
      'success'
    );
    await fetchDevices();
  } catch (e) {
    console.error(e);
    showToast('Server connection error', 'error');
  }
}

// Schedules (local demo)
function syncScheduleDeviceSelect() {
  // Danh sách thiết bị cho phần đặt lịch lấy trực tiếp từ state.devices.
  const select = el('scheduleDevice');
  if (!select) return;
  const devices = state.devices;
  if (!devices.length) {
    select.innerHTML = `<option value="">${currentLang === 'vi' ? 'Chưa có thiết bị' : 'No devices'}</option>`;
    return;
  }
  select.innerHTML = devices
    .map(d => {
      const typeText = d.type === 'door'
        ? (currentLang === 'vi' ? 'Cửa' : 'Door')
        : (currentLang === 'vi' ? 'Đèn' : 'Light');
      return `<option value="${d.id}">${escapeHtml(d.name)} (${typeText})</option>`;
    })
    .join('');
}

function getTargetStateForSchedule(device, actionValue) {
  // actionValue: ON/OFF (UI)
  if (!device) return null;
  if (device.type === 'door') return actionValue === 'ON' ? 'OPEN' : 'CLOSED';
  if (device.type === 'light') return actionValue === 'ON' ? 'ON' : 'OFF';
  return null;
}

function addSchedule() {
  // Lịch hẹn hiện đang chạy ở frontend local, chưa lưu xuống backend.
  const devId = el('scheduleDevice')?.value;
  const time = el('scheduleTime')?.value;
  const action = el('scheduleAction')?.value;

  if (!devId || !time) return showToast(currentLang === 'vi' ? 'Vui lòng chọn thiết bị và thời gian' : 'Please select a device and time', 'warning');
  const device = state.devices.find(d => String(d.id) === String(devId));
  if (!device) return showToast(currentLang === 'vi' ? 'Không tìm thấy thiết bị' : 'Device not found', 'error');

  const targetState = getTargetStateForSchedule(device, action);
  if (!targetState) return showToast(currentLang === 'vi' ? 'Loại thiết bị không được hỗ trợ' : 'Unsupported device type', 'warning');

  state.scheduledTasks.push({
    devId: device.id,
    time, // HH:mm
    targetState,
    createdAt: Date.now(),
    executed: false,
  });

  renderScheduleList();
  showToast(`${t('toast_schedule_saved')} ${time}!`, 'success');
  pushActionNotification(
    currentLang === 'vi' ? 'Lịch hẹn mới' : 'New schedule',
    `${device.name} @ ${time} -> ${targetState}`,
    'success'
  );
  if (el('scheduleTime')) el('scheduleTime').value = '';
}

function removeSchedule(idx) {
  const removed = state.scheduledTasks[idx];
  state.scheduledTasks.splice(idx, 1);
  renderScheduleList();
  showToast(t('toast_schedule_removed'), 'info');
  if (removed) {
    const dev = state.devices.find(d => d.id === removed.devId);
    pushActionNotification(
      currentLang === 'vi' ? 'Đã xóa lịch hẹn' : 'Schedule removed',
      `${dev?.name || removed.devId} @ ${removed.time}`,
      'warning'
    );
  }
}

function renderScheduleList() {
  const list = el('scheduleList');
  if (!list) return;
  if (!state.scheduledTasks.length) {
    list.innerHTML = `<div style="color:var(--text3);padding:18px 0;text-align:center;font-weight:900">${currentLang === 'vi' ? 'Chưa có lịch hẹn' : 'No schedules yet'}</div>`;
    return;
  }

  list.innerHTML = state.scheduledTasks.map((task, idx) => {
    const device = state.devices.find(d => d.id === task.devId);
    const devName = device ? device.name : task.devId;
    const isOn = task.targetState === 'ON' || task.targetState === 'OPEN';
    const targetText = task.targetState === 'OPEN'
      ? (currentLang === 'vi' ? 'MỞ' : 'OPEN')
      : task.targetState === 'CLOSED'
        ? (currentLang === 'vi' ? 'ĐÓNG' : 'CLOSED')
        : task.targetState;
    const deleteText = currentLang === 'vi' ? 'Xóa' : 'Delete';
    return `
      <div class="schedule-item">
        <div class="schedule-time">${escapeHtml(task.time)}</div>
        <div class="schedule-info">
          <div class="schedule-name">${escapeHtml(devName)}</div>
          <div class="schedule-meta">${escapeHtml(targetText)}</div>
        </div>
        <div class="schedule-actions">
          <span class="badge-pill ${isOn ? 'on' : 'off'}">${isOn ? 'ON' : 'OFF'}</span>
          <button class="btn btn-secondary btn-sm" onclick="removeSchedule(${idx})">
            ${deleteText}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function startScheduleTickerOnce() {
  // Mỗi giây kiểm tra xem có lịch nào khớp HH:mm hiện tại để tự thực thi.
  if (scheduleTickerStarted) return;
  scheduleTickerStarted = true;

  setInterval(() => {
    if (!state.scheduledTasks.length) return;
    const now = new Date();
    const hh = now.getHours().toString().padStart(2, '0');
    const mm = now.getMinutes().toString().padStart(2, '0');
    const currentTime = `${hh}:${mm}`;

    if (now.getSeconds() !== 0) return;

    const remainingTasks = [];

    state.scheduledTasks.forEach(task => {
      if (task.executed) return;
      if (task.time !== currentTime) {
        remainingTasks.push(task);
        return;
      }

      const device = state.devices.find(d => d.id === task.devId);
      if (!device) return;

      task.executed = true;
      toggleDevice(task.devId, task.targetState);
      const executedStateText = task.targetState === 'OPEN'
        ? (currentLang === 'vi' ? 'Mở' : 'Open')
        : task.targetState === 'CLOSED'
          ? (currentLang === 'vi' ? 'Đóng' : 'Closed')
          : task.targetState;
      showToast(`${t('toast_schedule_executed_prefix')} ${task.time}: ${device.name} -> ${executedStateText}`, 'info');
      pushActionNotification(
        currentLang === 'vi' ? 'Lịch hẹn đã chạy' : 'Schedule executed',
        `${device.name} @ ${task.time} -> ${executedStateText}`,
        'info'
      );
    });

    state.scheduledTasks = remainingTasks;
    renderScheduleList();
  }, 1000);
}

// App bootstrap
function enterApp(user) {
  // Đây là điểm bootstrap chính sau khi user đăng nhập thành công.
  setUserPanel(user);
  bindSocketEventsOnce();
  socket.emit('register_socket', { username: user?.username, role: user?.role });
  initDashboardExtras();
  loadNotifications();
  loadMqttConfig();
  fetchRooms();
  fetchScenes();

  el('loginPage').style.display = 'none';
  el('appShell').style.display = 'flex';

  fetchDevices().catch(() => showToast('Failed to load device list', 'error'));
  renderDashboard();

  // init schedule UI and ticker
  syncScheduleDeviceSelect();
  renderScheduleList();
  renderNotifications();
  renderMqttConfig();
  startMqttStatsTicker();
  startScheduleTickerOnce();

  // optional: pre-load history for better UX only when visiting
}

function checkAuth() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return;
  try {
    const user = JSON.parse(saved);
    if (!user) return;
    enterApp(user);
  } catch {
    // ignore
  }
}

// Make sure some functions are available for inline onclick
window.doLogin = doLogin;
window.setAuthMode = setAuthMode;
window.doRegister = doRegister;
window.doForgotPassword = doForgotPassword;
window.togglePasswordField = togglePasswordField;
window.doLogout = doLogout;
window.navigate = navigate;
window.refreshNow = refreshNow;
window.toggleDevice = toggleDevice;
window.activateScene = activateScene;
window.loadHistory = loadHistory;
window.resetHistoryFilters = resetHistoryFilters;
window.applyHistoryQuickRange = applyHistoryQuickRange;
window.exportHistoryCsv = exportHistoryCsv;
window.openAddDevice = openAddDevice;
window.saveDevice = saveDevice;
window.closeModal = closeModal;
window.addSchedule = addSchedule;
window.removeSchedule = removeSchedule;
window.renderDevices = renderDevices;
window.fetchUsers = fetchUsers;
window.openUserModal = openUserModal;
window.saveUser = saveUser;
window.changeUserRole = changeUserRole;
window.deleteUser = deleteUser;
window.deleteCurrentEditingUser = deleteCurrentEditingUser;
window.renderScheduleList = renderScheduleList;
window.syncScheduleDeviceSelect = syncScheduleDeviceSelect;
window.showToast = showToast;
window.toggleLang = toggleLang;
window.toggleTheme = toggleTheme;
window.deleteDevice = deleteDevice;
window.openRoomDevices = openRoomDevices;
window.openAddRoom = openAddRoom;
window.saveRoom = saveRoom;
window.deleteRoom = deleteRoom;
window.openSceneModal = openSceneModal;
window.saveScene = saveScene;
window.deleteCurrentScene = deleteCurrentScene;
window.toggleSceneActionRow = toggleSceneActionRow;
window.handleSceneTargetChange = handleSceneTargetChange;
window.openAccountModal = openAccountModal;
window.saveAccountPassword = saveAccountPassword;
window.sendAdminNotification = sendAdminNotification;
window.markNotificationRead = markNotificationRead;
window.markAllNotificationsRead = markAllNotificationsRead;
window.saveMqttConfig = saveMqttConfig;
window.testMqttConfig = testMqttConfig;

setupAuthPanels();
setupHistoryFilters();
setAuthMode('login');
applyLang();
syncTheme();
checkAuth();

