import {
  ApartmentOutlined,
  AuditOutlined,
  CalendarOutlined,
  BankOutlined,
  BarChartOutlined,
  ReadOutlined,
  CalculatorOutlined,
  CarryOutOutlined,
  CheckCircleOutlined,
  CheckSquareOutlined,
  CloseOutlined,
  CloudServerOutlined,
  DollarCircleOutlined,
  EyeOutlined,
  FileAddOutlined,
  FileProtectOutlined,
  FilterOutlined,
  GiftOutlined,
  FieldTimeOutlined,
  ScheduleOutlined,
  SettingOutlined,
  WalletOutlined,
  LogoutOutlined,
  MenuOutlined,
  PlusOutlined,
  SearchOutlined,
  RightOutlined,
  ReconciliationOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntApp,
  Button,
  ConfigProvider,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Input,
  Layout,
  Menu,
  Modal,
  Pagination,
  Radio,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { errorMessage, setUnauthorizedHandler } from "./api/client";
import { authApi, employeeApi, organizationApi } from "./api/hrtp";
import type { AuthUser, Employee, OrganizationContext } from "./api/hrtp";
import { AccountsWorkspace } from "./components/AccountsWorkspace";
import { SystemHealth } from "./components/SystemHealth";
import { EmployeeProfileDrawer, PeriodsPage, SettingsPage } from "./components/HRWorkspace";
import { ShiftWorkspace } from "./components/ShiftWorkspace";
import { AttendanceWorkspace } from "./components/AttendanceWorkspace";
import { OvertimeWorkspace } from "./components/OvertimeWorkspace";
import { ForcedPasswordChange, PasswordChangeDialog } from "./components/PasswordChange";
import { LeaveWorkspace } from "./components/LeaveWorkspace";
import { SalaryComponentsWorkspace } from "./components/SalaryComponentsWorkspace";
import { PayrollConfigurationWorkspace } from "./components/PayrollConfigurationWorkspace";
import { EmployeePayPlansWorkspace } from "./components/EmployeePayPlansWorkspace";
import { PayrollInputsWorkspace } from "./components/PayrollInputsWorkspace";
import { PayrollWorkspace } from "./components/PayrollWorkspace";
import { AuditWorkspace } from "./components/AuditWorkspace";
import { ContractsWorkspace } from "./components/ContractsWorkspace";
import { WelfareWorkspace } from "./components/WelfareWorkspace";
import { ReportsWorkspace } from "./components/ReportsWorkspace";
import { NotificationBell } from "./components/NotificationBell";
import { AssistantButton } from "./components/AssistantDrawer";
import { HandbookWorkspace } from "./components/HandbookWorkspace";
import uiTokens from "../../docs/config/hrtp-ui-tokens.json";

/** Local demo only (build arg VITE_DEMO_PASSWORD from DEMO_PASSWORD in .env): show the shared demo password in plain
 * text on the login form. Empty in any real deployment, which keeps the masked field. */
const DEMO_PASSWORD = (import.meta.env.VITE_DEMO_PASSWORD as string | undefined) || undefined;
const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;
type Route = "employees" | "accounts" | "organization" | "periods" | "settings" | "shifts" | "attendance" | "overtime" | "leave" | "salary-components" | "payroll-configuration" | "employee-pay-plans" | "payroll-inputs" | "payroll" | "audit" | "contracts" | "welfare" | "reports" | "health" | "handbook";
const routeTitles: Record<Route, string> = {
  employees: "Nhân sự",
  accounts: "Tài khoản",
  organization: "Tổ chức",
  periods: "Kỳ công",
  settings: "Thiết lập",
  health: "Hệ thống",
  shifts: "Ca & phân ca",
  attendance: "Chấm công",
  overtime: "Tăng ca (OT)",
  leave: "Nghỉ & quỹ phép",
  "salary-components": "Cấu phần lương",
  "payroll-configuration": "Đơn giá & công thức",
  "employee-pay-plans": "Kế hoạch trả lương",
  "payroll-inputs": "Đầu vào lương",
  payroll: "Bảng lương",
  audit: "Nhật ký kiểm toán",
  contracts: "Hợp đồng & chấm dứt",
  welfare: "Phúc lợi",
  reports: "Báo cáo",
  handbook: "Cẩm nang & chính sách",
};

type WorkspaceModule = "personnel" | "attendance" | "leave" | "payroll" | "admin";

const routeModules: Record<Route, WorkspaceModule> = {
  employees: "personnel",
  organization: "personnel",
  contracts: "personnel",
  periods: "attendance",
  shifts: "attendance",
  attendance: "attendance",
  overtime: "attendance",
  leave: "leave",
  "salary-components": "payroll",
  "payroll-configuration": "payroll",
  "employee-pay-plans": "payroll",
  "payroll-inputs": "payroll",
  payroll: "payroll",
  welfare: "payroll",
  reports: "payroll",
  accounts: "admin",
  settings: "admin",
  health: "admin",
  audit: "admin",
  handbook: "admin",
};

// One icon per destination, reused by navigation, breadcrumbs and page headings.
const routeIcons: Record<Route, React.ReactNode> = {
  employees: <TeamOutlined aria-hidden="true" />,
  contracts: <FileProtectOutlined aria-hidden="true" />,
  organization: <ApartmentOutlined aria-hidden="true" />,
  periods: <CalendarOutlined aria-hidden="true" />,
  shifts: <ScheduleOutlined aria-hidden="true" />,
  attendance: <CheckSquareOutlined aria-hidden="true" />,
  overtime: <FieldTimeOutlined aria-hidden="true" />,
  leave: <CarryOutOutlined aria-hidden="true" />,
  payroll: <ReconciliationOutlined aria-hidden="true" />,
  "salary-components": <DollarCircleOutlined aria-hidden="true" />,
  "payroll-configuration": <CalculatorOutlined aria-hidden="true" />,
  "employee-pay-plans": <WalletOutlined aria-hidden="true" />,
  "payroll-inputs": <FileAddOutlined aria-hidden="true" />,
  welfare: <GiftOutlined aria-hidden="true" />,
  reports: <BarChartOutlined aria-hidden="true" />,
  accounts: <UserOutlined aria-hidden="true" />,
  settings: <SettingOutlined aria-hidden="true" />,
  audit: <AuditOutlined aria-hidden="true" />,
  health: <CloudServerOutlined aria-hidden="true" />,
  handbook: <ReadOutlined aria-hidden="true" />,
};

function canSeePayroll(user: AuthUser): boolean {
  return user.roles.includes("KT") && (user.permissions.includes("contract.read") || user.permissions.includes("payroll.read"));
}

/** The server filters the catalog; this only decides whether to show the menu entry. */
function canSeeReports(user: AuthUser): boolean {
  return ["attendance.read", "employee.read", "payroll.read", "insurance.read", "tax.read"].some(permission => user.permissions.includes(permission));
}

function currentRoute(user: AuthUser): Route {
  const route = window.location.hash.replace("#/", "") as Route;
  const allowed =
    route === "employees" ? user.permissions.includes("employee.read")
      : route === "shifts" ? user.permissions.includes("shift.read")
        : route === "attendance" ? user.permissions.includes("attendance.read")
        : route === "overtime" ? user.permissions.includes("overtime.read")
          : route === "leave" ? (user.permissions.includes("leave.read") || user.permissions.includes("leave.balance.read"))
          : route === "salary-components" || route === "payroll-configuration" || route === "employee-pay-plans" ? user.roles.includes("KT") && user.permissions.includes("payroll.components.read")
          : route === "payroll-inputs" ? user.roles.includes("KT") && user.permissions.includes("payroll.inputs.read")
          : route === "payroll" ? canSeePayroll(user)
          : route === "audit" ? user.permissions.includes("audit.read")
          : route === "reports" ? canSeeReports(user)
          : route === "welfare" ? user.roles.includes("KT") && user.permissions.includes("welfare.read")
          : route === "contracts" ? user.roles.includes("KT") && user.permissions.includes("contract.read")
          : route === "accounts" ? user.permissions.includes("accounts.manage")
            : route === "settings" ? user.permissions.includes("settings.manage")
              : route === "periods" ? user.permissions.includes("period.read")
                : route === "organization" || route === "health" || route === "handbook";
  return allowed ? route
    : user.permissions.includes("employee.read") ? "employees"
      : user.permissions.includes("attendance.read") ? "attendance"
        : user.permissions.includes("overtime.read") ? "overtime"
        : (user.permissions.includes("leave.read") || user.permissions.includes("leave.balance.read")) ? "leave"
        : user.roles.includes("KT") && user.permissions.includes("payroll.components.read") ? "salary-components"
        : user.roles.includes("KT") && user.permissions.includes("payroll.inputs.read") ? "payroll-inputs"
        : user.permissions.includes("accounts.manage") ? "accounts"
          : user.permissions.includes("period.read") ? "periods"
            : user.permissions.includes("settings.manage") ? "settings"
              : "organization";
}

function go(route: Route) {
  window.location.hash = "#/" + route;
}

function HorizonArt({ className }: { className: string }) {
  return (
    <svg className={`horizon-art ${className}`} viewBox="0 0 600 200" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <circle className="horizon-sun" cx="470" cy="49" r="26" />
      <path className="horizon-cloud" d="M75 72c0-9 8-16 17-15 4-17 29-20 36-3 14-5 27 5 27 18Zm232 26c0-9 8-15 17-14 5-19 33-21 40-3 15-4 28 5 28 17Z" />
      <path className="horizon-back" d="M0 141C102 83 178 178 294 133S483 90 600 124V200H0Z" />
      <path className="horizon-front" d="M0 170C127 117 198 191 328 156S500 136 600 157V200H0Z" />
      <path className="horizon-line" d="M0 155C111 102 190 187 311 144S497 114 600 139" />
    </svg>
  );
}

function Login({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [form] = Form.useForm<{ username: string; password: string }>();
  const mutation = useMutation({
    mutationFn: ({
      username,
      password,
    }: {
      username: string;
      password: string;
    }) => authApi.login(username, password),
    onSuccess: ({ user }) => {
      form.resetFields();
      onLogin(user);
    },
    onError: (error) =>
      form.setFields([{ name: "password", errors: [errorMessage(error)] }]),
  });
  return (
    <main className="login-page login-page-illustrated" aria-labelledby="login-title">
      <section className="login-panel">
        <div className="login-brand">
          <img src="/favicon.svg" alt="" width="40" height="40" />
          <div>
            <strong>HRTP</strong>
            <span>Chấm công & tiền lương</span>
          </div>
        </div>
        <div>
          <p className="eyebrow">ĐĂNG NHẬP HỆ THỐNG</p>
          <Title id="login-title" level={1}>
            Chào mừng trở lại
          </Title>
        </div>
        <Form
          form={form}
          layout="vertical"
          requiredMark="optional"
          onFinish={(values) => mutation.mutate(values)}
          disabled={mutation.isPending}
          autoComplete="on"
          initialValues={DEMO_PASSWORD ? { password: DEMO_PASSWORD } : undefined}
        >
          <Form.Item
            name="username"
            label="Tên đăng nhập"
            rules={[{ required: true, message: "Nhập tên đăng nhập." }]}
          >
            <Input autoComplete="username" autoFocus />
          </Form.Item>
          <Form.Item
            name="password"
            label="Mật khẩu"
            rules={[{ required: true, message: "Nhập mật khẩu." }]}
          >
            {DEMO_PASSWORD ? <Input autoComplete="current-password" /> : <Input.Password autoComplete="current-password" />}
          </Form.Item>
          <Button
            htmlType="submit"
            type="primary"
            size="large"
            block
            loading={mutation.isPending}
          >
            Đăng nhập
          </Button>
        </Form>
        {DEMO_PASSWORD && (
          <Text type="secondary" className="login-note">
            Bản demo: mọi tài khoản dùng mật khẩu <code>{DEMO_PASSWORD}</code> (vd. <code>kt.all</code>, <code>tt.bn</code>, <code>qd.bn</code>, <code>admin</code>).
          </Text>
        )}
      </section>
    </main>
  );
}

function Shell({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [route, setRoute] = useState(() => currentRoute(user));
  const [open, setOpen] = useState(false);
  const [passwordChangeOpen, setPasswordChangeOpen] = useState(false);
  const overlayConfig = useMemo(() => ({
    classNames: { content: `hrtp-overlay overlay-${routeModules[route]}` },
  }), [route]);
  useEffect(() => {
    const update = () => setRoute(currentRoute(user));
    window.addEventListener("hashchange", update);
    if (!window.location.hash) go(currentRoute(user));
    return () => window.removeEventListener("hashchange", update);
  }, [user]);
  const employeeRead = user.permissions.includes("employee.read");
  const accountManage = user.permissions.includes("accounts.manage");
  const periodRead = user.permissions.includes("period.read");
  const settingsManage = user.permissions.includes("settings.manage");
  const attendanceRead = user.permissions.includes("attendance.read");
  const overtimeRead = user.permissions.includes("overtime.read");
  const leaveRead = user.permissions.includes("leave.read") || user.permissions.includes("leave.balance.read");
  const items = [
    employeeRead
      ? { key: "employees", label: "Nhân sự" }
      : null,
    accountManage
      ? { key: "accounts", label: "Tài khoản" }
      : null,
    periodRead
      ? { key: "periods", label: "Kỳ công" }
      : null,
    settingsManage
      ? { key: "settings", label: "Thiết lập" }
      : null,
    user.permissions.includes("shift.read") ? { key: "shifts", label: "Ca & phân ca" } : null,
    attendanceRead ? { key: "attendance", label: "Chấm công" } : null,
    overtimeRead ? { key: "overtime", label: "Tăng ca (OT)" } : null,
    leaveRead ? { key: "leave", label: "Nghỉ & quỹ phép" } : null,
    user.roles.includes("KT") && user.permissions.includes("payroll.components.read") ? { key: "salary-components", label: "Cấu phần lương" } : null,
    user.roles.includes("KT") && user.permissions.includes("payroll.components.read") ? { key: "payroll-configuration", label: "Đơn giá & công thức" } : null,
    user.roles.includes("KT") && user.permissions.includes("payroll.components.read") ? { key: "employee-pay-plans", label: "Kế hoạch trả lương" } : null,
    user.roles.includes("KT") && user.permissions.includes("payroll.inputs.read") ? { key: "payroll-inputs", label: "Đầu vào lương" } : null,
    canSeePayroll(user) ? { key: "payroll", label: "Bảng lương" } : null,
    canSeeReports(user) ? { key: "reports", label: "Báo cáo" } : null,
    user.roles.includes("KT") && user.permissions.includes("welfare.read") ? { key: "welfare", label: "Phúc lợi" } : null,
    user.roles.includes("KT") && user.permissions.includes("contract.read") ? { key: "contracts", label: "Hợp đồng & chấm dứt" } : null,
    user.permissions.includes("audit.read") ? { key: "audit", label: "Nhật ký kiểm toán" } : null,
    { key: "organization", label: "Tổ chức" },
    { key: "health", label: "Hệ thống" },
    { key: "handbook", label: "Cẩm nang & chính sách" },
  ].filter(Boolean) as { key: Route; label: string }[];
  const navigationGroups = [
    { key: "people", label: "NHÂN SỰ", routes: ["employees", "contracts", "organization"] },
    { key: "time", label: "THỜI GIAN LÀM VIỆC", routes: ["periods", "shifts", "attendance", "overtime", "leave"] },
    { key: "pay", label: "TIỀN LƯƠNG", routes: ["payroll", "salary-components", "payroll-configuration", "employee-pay-plans", "payroll-inputs", "welfare", "reports"] },
    { key: "system", label: "QUẢN TRỊ", routes: ["accounts", "settings", "audit", "health"] },
    { key: "support", label: "HỖ TRỢ", routes: ["handbook"] },
  ].map(group => ({
    key: group.key,
    type: "group" as const,
    label: group.label,
    children: group.routes.flatMap(key => {
      const item = items.find(entry => entry.key === key);
      return item ? [{ ...item, icon: routeIcons[item.key], title: item.label }] : [];
    }),
  })).filter(group => group.children.length);
  const navigate = (next: Route) => {
    setOpen(false);
    go(next);
  };
  const menu = (
    <Menu
      mode="inline"
      theme="dark"
      selectedKeys={[route]}
      items={navigationGroups}
      onClick={({ key }) => navigate(key as Route)}
    />
  );
  const scope = user.assignments.length
    ? user.assignments.map((assignment) => assignment.scopeName).join(", ")
    : "Không có phạm vi đơn vị";
  const logout = async () => {
    try {
      await authApi.logout();
    } finally {
      onLogout();
    }
  };
  const body =
    route === "employees" ? (
      <EmployeesPage user={user} />
    ) : route === "accounts" ? (
      <AccountsWorkspace user={user} />
    ) : route === "periods" ? (
      <PeriodsPage user={user} />
    ) : route === "settings" ? (
      <SettingsPage />
    ) : route === "shifts" ? (
      <ShiftWorkspace user={user} />
    ) : route === "attendance" ? (
      <AttendanceWorkspace user={user} />
    ) : route === "overtime" ? (
      <OvertimeWorkspace user={user} />
    ) : route === "leave" ? (
      <LeaveWorkspace user={user} />
    ) : route === "salary-components" ? (
      <SalaryComponentsWorkspace user={user} />
    ) : route === "payroll-configuration" ? (
      <PayrollConfigurationWorkspace user={user} />
    ) : route === "employee-pay-plans" ? (
      <EmployeePayPlansWorkspace user={user} />
    ) : route === "payroll-inputs" ? (
      <PayrollInputsWorkspace user={user} />
    ) : route === "payroll" ? (
      <PayrollWorkspace user={user} />
    ) : route === "reports" ? (
      <ReportsWorkspace />
    ) : route === "welfare" ? (
      <WelfareWorkspace user={user} />
    ) : route === "contracts" ? (
      <ContractsWorkspace user={user} />
    ) : route === "audit" ? (
      <AuditWorkspace />
    ) : route === "handbook" ? (
      <HandbookWorkspace user={user} allowedRoutes={items.map(item => item.key)}
        onNavigate={next => { if (items.some(item => item.key === next)) navigate(next as Route); }} />
    ) : route === "organization" ? (
      <OrganizationPage />
    ) : (
      <SystemHealth />
    );
  return (
    <ConfigProvider drawer={overlayConfig} modal={overlayConfig}>
    <AntApp component={false}>
    <Layout className="app-shell" data-module={routeModules[route]}>
      <a className="skip-link" href="#main">
        Đến nội dung chính
      </a>
      <Sider
        className="desktop-sider"
        width={uiTokens.layout.sidebarWidthPx}
        breakpoint="xl"
        collapsedWidth={uiTokens.layout.sidebarCollapsedWidthPx}
        theme="dark"
      >
        <HorizonArt className="horizon-sidebar" />
        <div className="side-brand">
          <img src="/favicon.svg" alt="" width="32" height="32" />
          <span className="brand-copy"><strong>HRTP<span>.</span></strong><small>Chấm công & tiền lương</small></span>
        </div>
        <nav className="shell-navigation" aria-label="Các phân hệ HRTP">{menu}</nav>
        <div className="sidebar-scope">
          <ApartmentOutlined aria-hidden="true" />
          <span><strong>Phạm vi làm việc</strong><small>{scope}</small></span>
        </div>
      </Sider>
      <Drawer
        className="mobile-nav"
        title="HRTP"
        placement="left"
        open={open}
        onClose={() => setOpen(false)}
        styles={{ body: { padding: 0 } }}
      >
        <nav aria-label="Các phân hệ HRTP">{menu}</nav>
      </Drawer>
      <Layout>
        <Header className="shell-header">
          <Button
            className="mobile-menu"
            type="text"
            icon={<MenuOutlined />}
            aria-label="Mở điều hướng"
            onClick={() => setOpen(true)}
          />
          <div className="header-location">
            <span className="workspace-mark" aria-hidden="true">
              {routeIcons[route]}
            </span>
            <Text type="secondary" className="parent-crumb">Không gian làm việc</Text>
            <RightOutlined className="parent-crumb" aria-hidden="true" />
            <strong>{routeTitles[route]}</strong>
          </div>
          <div className="header-scope" title={scope} aria-label={`Phạm vi: ${scope}`}><ApartmentOutlined aria-hidden="true" /><span>{scope}</span></div>
          <div className="header-actions">
          <AssistantButton pageKey={route} onNavigate={(next) => navigate(next as Route)} />
          <NotificationBell onOpen={(linkKey) => navigate(linkKey as Route)} />
          <Dropdown
            menu={{
              items: [
                {
                  key: "password",
                  label: "Đổi mật khẩu",
                  onClick: () => setPasswordChangeOpen(true),
                },
                {
                  key: "logout",
                  icon: <LogoutOutlined />,
                  label: "Đăng xuất",
                  onClick: () => void logout(),
                },
              ],
            }}
            trigger={["click"]}
          >
            <Button className="user-menu" type="text">
              <span className="user-avatar" aria-hidden="true">
                {user.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span>
                <strong>{user.displayName}</strong>
                <small>{user.roles.join(" · ")}</small>
              </span>
            </Button>
          </Dropdown>
          </div>
        </Header>
        <Content
          id="main"
          className="app-content"
          data-module={routeModules[route]}
          tabIndex={-1}
        >
          <div className="workspace-context"><ApartmentOutlined aria-hidden="true" /><span>Phạm vi: <strong>{scope}</strong></span></div>
          <div className="workspace-body">{route !== "attendance" && route !== "payroll" && <HorizonArt className="horizon-heading" />}<span className="page-symbol" aria-hidden="true">{routeIcons[route]}</span>{body}</div>
        </Content>
      </Layout>
    <PasswordChangeDialog open={passwordChangeOpen} onClose={() => setPasswordChangeOpen(false)} onSuccess={onLogout} />
    </Layout>
    </AntApp>
    </ConfigProvider>
  );
}

function EmployeesPage({ user }: { user: AuthUser }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [draftSearch, setDraftSearch] = useState("");
  const [orgUnitId, setOrgUnitId] = useState<string>();
  const [status, setStatus] = useState<"ACTIVE" | "TERMINATED" | undefined>();
  const [selected, setSelected] = useState<Employee | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const context = useQuery({
    queryKey: ["organization-context"],
    queryFn: organizationApi.context,
  });
  const list = useQuery({
    queryKey: ["employees", page, search, orgUnitId, status],
    queryFn: () =>
      employeeApi.list({ page, pageSize: 20, search, orgUnitId, status }),
    placeholderData: (previous) => previous,
  });
  const canCreate = user.permissions.includes("employee.create");
  const resetPage = (next: {
    search?: string;
    unit?: string;
    status?: "ACTIVE" | "TERMINATED";
  }) => {
    setPage(1);
    if ("search" in next) setSearch(next.search ?? "");
    if ("unit" in next) setOrgUnitId(next.unit);
    if ("status" in next) setStatus(next.status);
  };
  const clearFilters = () => {
    setDraftSearch("");
    resetPage({ search: "", unit: undefined, status: undefined });
  };
  return (
    <div className="content-stack personnel-workspace">
      <div className="page-heading">
        <div>
          <p className="eyebrow">QUẢN LÝ ĐỘI NGŨ</p>
          <Title level={1}>Nhân sự</Title>
        </div>
        {canCreate && (
          <Button
            type="primary"
            size="large"
            icon={<PlusOutlined aria-hidden="true" />}
            onClick={() => setCreateOpen(true)}
          >
            Thêm nhân sự
          </Button>
        )}
      </div>
      <section className="stats-strip" aria-label="Tổng quan phạm vi nhân sự">
        <div className="stat-block stat-primary"><span className="stat-symbol" aria-hidden="true"><TeamOutlined /></span><span className="stat-copy"><strong>Nhân sự phù hợp</strong><b>{list.data?.total ?? (list.isError ? "—" : "…")}</b></span></div>
        <div className="stat-block"><span className="stat-symbol" aria-hidden="true"><ApartmentOutlined /></span><span className="stat-copy"><strong>Đơn vị trong phạm vi</strong><b>{context.data?.units.length ?? (context.isError ? "—" : "…")}</b></span></div>
        <div className="stat-block"><span className="stat-symbol" aria-hidden="true"><UserOutlined /></span><span className="stat-copy"><strong>Phạm vi được cấp</strong><b>{user.assignments.length}</b></span></div>
      </section>
      <section className="panel personnel-roster" aria-labelledby="personnel-roster-title">
      <h2 className="sr-only" id="personnel-roster-title">Danh sách nhân sự</h2>
      <div className="personnel-status-filter">
        <span className="filter-caption"><FilterOutlined aria-hidden="true" /> Trạng thái</span>
        <Radio.Group aria-label="Lọc theo trạng thái" value={status ?? "ALL"} onChange={(event) => resetPage({ status: event.target.value === "ALL" ? undefined : event.target.value })}>
          <Radio.Button value="ALL">Tất cả</Radio.Button>
          <Radio.Button value="ACTIVE"><CheckCircleOutlined aria-hidden="true" /> Đang làm việc</Radio.Button>
          <Radio.Button value="TERMINATED">Đã nghỉ việc</Radio.Button>
        </Radio.Group>
      </div>
      <section className="personnel-filters" aria-label="Bộ lọc nhân sự">
        <label><span>Tìm kiếm nhân sự</span>
        <Input.Search
          aria-label="Tìm kiếm nhân sự"
          placeholder="Tìm theo mã hoặc họ tên"
          value={draftSearch}
          onChange={(event) => setDraftSearch(event.target.value)}
          onSearch={(value) => resetPage({ search: value.trim() })}
          enterButton={<SearchOutlined aria-label="Tìm kiếm nhân sự" />}
          allowClear
        />
        </label>
        <label><span>Đơn vị</span>
        <Select
          aria-label="Lọc theo đơn vị"
          placeholder="Tất cả đơn vị"
          value={orgUnitId}
          allowClear
          loading={context.isLoading}
          options={context.data?.units.map((unit) => ({
            value: unit.id,
            label: unit.pathLabel,
          }))}
          onChange={(value) => resetPage({ unit: value })}
        />
        </label>
        <Button type="text" onClick={clearFilters}>Xóa bộ lọc</Button>
      </section>
      {(search || orgUnitId || status) && <div className="personnel-applied-filters" aria-label="Bộ lọc đang áp dụng">
        {search && <Tag>Tìm: {search}<Button type="text" className="filter-tag-clear" icon={<CloseOutlined aria-hidden="true" />} aria-label="Bỏ lọc tìm kiếm" onClick={() => { setDraftSearch(""); resetPage({ search: "" }); }} /></Tag>}
        {orgUnitId && <Tag>Đơn vị: {context.data?.units.find(unit => unit.id === orgUnitId)?.name ?? "Đã chọn"}<Button type="text" className="filter-tag-clear" icon={<CloseOutlined aria-hidden="true" />} aria-label="Bỏ lọc đơn vị" onClick={() => resetPage({ unit: undefined })} /></Tag>}
        {status && <Tag>{status === "ACTIVE" ? "Đang làm việc" : "Đã nghỉ việc"}<Button type="text" className="filter-tag-clear" icon={<CloseOutlined aria-hidden="true" />} aria-label="Bỏ lọc trạng thái" onClick={() => resetPage({ status: undefined })} /></Tag>}
      </div>}
      {context.isError && <Alert type="error" showIcon message="Không tải được đơn vị" description={errorMessage(context.error)} />}
      <div className="personnel-result-note" role="status" aria-live="polite">{list.isError ? "Danh sách chưa tải được" : list.isFetching ? "Đang cập nhật danh sách…" : `${list.data?.total ?? 0} nhân sự phù hợp trong phạm vi`}</div>
      <div className="table-panel" role="region" tabIndex={0} aria-label="Bảng danh sách nhân sự, có thể cuộn ngang">
        {list.isError ? (
          <Alert
            type="error"
            showIcon
            message="Không tải được danh sách nhân sự"
            description={errorMessage(list.error)}
          />
        ) : (
          <>
            <Table<Employee>
              size="middle"
              rowKey="id"
              loading={list.isLoading}
              dataSource={list.data?.items ?? []}
              locale={{
                emptyText: <Empty description={search || orgUnitId || status ? "Không có nhân sự phù hợp bộ lọc" : "Chưa có nhân sự trong phạm vi"}>{(search || orgUnitId || status) && <Button onClick={clearFilters}>Xóa bộ lọc</Button>}</Empty>,
              }}
              onRow={(record) => ({
                onClick: () => setSelected(record),
                className: "clickable-row",
              })}
              pagination={false}
              scroll={{ x: 1000 }}
              columns={[
                {
                  title: "Họ và tên",
                  dataIndex: "fullName",
                  width: 250,
                  render: (value, record, index) => <div className="person-cell"><span className={`person-mark person-tone-${index % 4}`} aria-hidden="true">{value.trim().split(/\s+/).slice(-2).map((part: string) => part[0]).join("")}</span><span><Button type="link" className="person-name" onClick={(event) => { event.stopPropagation(); setSelected(record); }}>{value}</Button><small className="table-subtext">{record.code}</small></span></div>,
                },
                {
                  title: "Đơn vị",
                  key: "unit",
                  render: (_, record) => (
                    <span>
                      {record.orgUnit.name}
                      <small className="table-subtext">
                        {record.orgUnit.code}
                      </small>
                    </span>
                  ),
                },
                {
                  title: "Chức danh",
                  key: "title",
                  render: (_, record) => record.jobTitle?.name ?? "Chưa cung cấp",
                },
                {
                  title: "Trạng thái",
                  dataIndex: "status",
                  width: 165,
                  render: (value) => (
                    <Tag color={value === "ACTIVE" ? "success" : "default"}>
                      {value === "ACTIVE" ? "Đang làm việc" : "Đã nghỉ việc"}
                    </Tag>
                  ),
                },
                { title: "Ngày vào làm", dataIndex: "hireDate", width: 140, render: (value: string) => value.slice(0, 10).split("-").reverse().join("/") },
                { title: "Hồ sơ", key: "profile", width: 100, render: (_, record) => <Tooltip title="Xem hồ sơ"><Button type="text" className="row-action" icon={<EyeOutlined aria-hidden="true" />} onClick={(event) => { event.stopPropagation(); setSelected(record); }} aria-label={`Xem hồ sơ ${record.fullName}`}>Xem</Button></Tooltip> },
              ]}
            />
            <div className="table-footer">
              <Text type="secondary">
                {list.data?.total ? `Hiển thị ${(page - 1) * list.data.pageSize + 1}–${Math.min(page * list.data.pageSize, list.data.total)} trong ${list.data.total} nhân sự` : "0 nhân sự"}
              </Text>
              <Pagination
                current={list.data?.page ?? page}
                pageSize={list.data?.pageSize ?? 20}
                size="small"
                total={list.data?.total ?? 0}
                showSizeChanger={false}
                onChange={(next) => setPage(next)}
              />
            </div>
          </>
        )}
      </div>
      </section>
      <EmployeeDrawer employee={selected} user={user} onClose={() => setSelected(null)} />
      <CreateEmployee
        open={createOpen}
        context={context.data}
        loadingContext={context.isLoading}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}

function EmployeeDrawer({
  employee,
  user,
  onClose,
}: {
  employee: Employee | null;
  user: AuthUser;
  onClose: () => void;
}) {
  return <EmployeeProfileDrawer employee={employee} user={user} onClose={onClose} />;
}

function CreateEmployee({
  open,
  context,
  loadingContext,
  onClose,
}: {
  open: boolean;
  context: OrganizationContext | undefined;
  loadingContext: boolean;
  onClose: () => void;
}) {
  const [form] = Form.useForm();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: employeeApi.create,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["employees"] });
      form.resetFields();
      onClose();
    },
    onError: (error) =>
      form.setFields([{ name: "code", errors: [errorMessage(error)] }]),
  });
  const allowedUnits =
    context?.units.filter(
      (unit) => unit.type === "TEAM" || unit.type === "DEPARTMENT",
    ) ?? [];
  return (
    <Modal
      title="Thêm nhân sự"
      className="employee-create-modal"
      width={640}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      afterClose={() => form.resetFields()}
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark="optional"
        onFinish={(values) =>
          mutation.mutate({
            ...values,
            code: values.code.trim().toUpperCase(),
            fullName: values.fullName.trim(),
            nationality: values.nationality?.trim() || undefined,
            email: values.email?.trim() || undefined,
            phone: values.phone?.trim() || undefined,
            jobTitleId: values.jobTitleId || undefined,
          })
        }
        disabled={mutation.isPending}
      >
        <div className="form-grid">
          <Form.Item
            name="code"
            label="Mã nhân sự"
            rules={[
              { required: true, message: "Nhập mã nhân sự." },
              {
                pattern: /^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$/,
                message: "Dùng 2–32 ký tự: chữ, số, gạch dưới hoặc gạch ngang.",
              },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="fullName"
            label="Họ và tên"
            rules={[
              {
                required: true,
                min: 2,
                max: 120,
                message: "Nhập họ tên từ 2 đến 120 ký tự.",
              },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="gender"
            label="Giới tính"
            rules={[{ required: true, message: "Chọn giới tính." }]}
          >
            <Select
              options={[
                { value: "MALE", label: "Nam" },
                { value: "FEMALE", label: "Nữ" },
                { value: "OTHER", label: "Khác" },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="nationality"
            label="Quốc tịch"
            initialValue="Việt Nam"
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="dob"
            label="Ngày sinh"
            rules={[{ required: true, message: "Chọn ngày sinh." }]}
          >
            <Input type="date" />
          </Form.Item>
          <Form.Item
            name="hireDate"
            label="Ngày vào làm"
            dependencies={["dob"]}
            rules={[
              { required: true, message: "Chọn ngày vào làm." },
              ({ getFieldValue }) => ({
                validator: (_, value) =>
                  !value ||
                  !getFieldValue("dob") ||
                  value > getFieldValue("dob")
                    ? Promise.resolve()
                    : Promise.reject(
                        new Error("Ngày vào làm phải sau ngày sinh."),
                      ),
              }),
            ]}
          >
            <Input type="date" max={new Date().toISOString().slice(0, 10)} />
          </Form.Item>
          <Form.Item
            className="form-span-2"
            name="orgUnitId"
            label="Đơn vị"
            rules={[{ required: true, message: "Chọn đơn vị." }]}
          >
            <Select
              loading={loadingContext}
              options={allowedUnits.map((unit) => ({
                value: unit.id,
                label: unit.pathLabel,
              }))}
            />
          </Form.Item>
          <Form.Item name="jobTitleId" label="Chức danh">
            <Select
              allowClear
              options={context?.jobTitles.map((title) => ({
                value: title.id,
                label: title.name + " (" + title.code + ")",
              }))}
            />
          </Form.Item>
          <Form.Item
            name="email"
            label="Email"
            rules={[{ type: "email", message: "Email không hợp lệ." }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="Điện thoại">
            <Input />
          </Form.Item>
        </div>
        <Space className="modal-actions">
          <Button onClick={onClose}>Hủy</Button>
          <Button type="primary" htmlType="submit" loading={mutation.isPending}>
            Lưu nhân sự
          </Button>
        </Space>
      </Form>
    </Modal>
  );
}


function OrganizationPage() {
  const context = useQuery({
    queryKey: ["organization-context"],
    queryFn: organizationApi.context,
  });
  return (
    <div className="content-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">CƠ CẤU / PHẠM VI</p>
          <Title level={1}>Tổ chức</Title>
        </div>
      </div>
      {context.isError ? (
        <Alert
          type="error"
          showIcon
          message="Không tải được cơ cấu tổ chức"
          description={errorMessage(context.error)}
        />
      ) : (
        <section className="panel table-panel" role="region" tabIndex={0} aria-label="Bảng cơ cấu tổ chức, có thể cuộn ngang">
          <div className="context-strip">
            <BankOutlined aria-hidden="true" />
            <span>
              Dữ liệu hiệu lực tại <strong>{context.data?.asOf ?? "—"}</strong>
            </span>
          </div>
          <Table
            rowKey="id"
            loading={context.isLoading}
            dataSource={context.data?.units ?? []}
            pagination={false}
            scroll={{ x: 700 }}
            locale={{
              emptyText: <Empty description="Không có đơn vị trong phạm vi" />,
            }}
            columns={[
              { title: "Đơn vị", dataIndex: "pathLabel" },
              { title: "Mã", dataIndex: "code", width: 150 },
              { title: "Loại", dataIndex: "type", width: 160 },
              { title: "Cấp", dataIndex: "level", width: 100, align: "right" },
            ]}
          />
        </section>
      )}
    </div>
  );
}

// Delegate only from the focused table region, never from controls within its rows.
function handleTableKeys(event: KeyboardEvent<HTMLDivElement>) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.tabIndex !== 0 || target.getAttribute("role") !== "region") return;
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const scroller = Array.from(target.querySelectorAll<HTMLElement>(".ant-table-content, .ant-table-body"))
    .find(element => element.scrollWidth > element.clientWidth);
  if (!scroller) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? scroller.scrollWidth
    : scroller.scrollLeft + (event.key === "ArrowRight" ? 96 : -96);
  scroller.scrollLeft = next;
}

export function App() {
  const client = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [resolved, setResolved] = useState(false);
  const me = useQuery({ queryKey: ["me"], queryFn: authApi.me, retry: false });
  useEffect(() => {
    if (me.data) {
      setUser(me.data.user);
      setResolved(true);
    } else if (me.isError) setResolved(true);
  }, [me.data, me.isError]);
  useEffect(() => {
    setUnauthorizedHandler(() => {
      client.clear();
      setUser(null);
      setResolved(true);
    });
    return () => setUnauthorizedHandler(undefined);
  }, [client]);
  const establish = (next: AuthUser) => {
    client.clear();
    setUser(next);
    setResolved(true);
    go(currentRoute(next));
  };
  const end = () => {
    client.clear();
    setUser(null);
    setResolved(true);
    window.location.hash = "#/";
  };
  if (!resolved)
    return (
      <main className="session-loading" aria-live="polite">
        <Spin size="large" />
        <span>Đang kiểm tra phiên làm việc…</span>
      </main>
    );
  return user ? (
    <AntApp>
      <div onKeyDown={handleTableKeys}>
        {user.requiresPasswordChange ? <ForcedPasswordChange onSuccess={end} /> : <Shell key={user.id} user={user} onLogout={end} />}
      </div>
    </AntApp>
  ) : (
    <Login onLogin={establish} />
  );
}
