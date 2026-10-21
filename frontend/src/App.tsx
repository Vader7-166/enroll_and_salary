import {
  ApartmentOutlined,
  AuditOutlined,
  CalendarOutlined,
  BankOutlined,
  LogoutOutlined,
  MenuOutlined,
  PlusOutlined,
  SearchOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntApp,
  Button,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Input,
  Layout,
  Menu,
  Modal,
  Pagination,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
const { Header, Sider, Content } = Layout;
const { Title, Paragraph, Text } = Typography;
type Route = "employees" | "accounts" | "organization" | "periods" | "settings" | "shifts" | "attendance" | "overtime" | "leave" | "salary-components" | "health";
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
};

function currentRoute(user: AuthUser): Route {
  const route = window.location.hash.replace("#/", "") as Route;
  const allowed =
    route === "employees" ? user.permissions.includes("employee.read")
      : route === "shifts" ? user.permissions.includes("shift.read")
        : route === "attendance" ? user.permissions.includes("attendance.read")
        : route === "overtime" ? user.permissions.includes("overtime.read")
          : route === "leave" ? (user.permissions.includes("leave.read") || user.permissions.includes("leave.balance.read"))
          : route === "salary-components" ? user.roles.includes("KT") && user.permissions.includes("payroll.components.read")
          : route === "accounts" ? user.permissions.includes("accounts.manage")
            : route === "settings" ? user.permissions.includes("settings.manage")
              : route === "periods" ? user.permissions.includes("period.read")
                : route === "organization" || route === "health";
  return allowed ? route
    : user.permissions.includes("employee.read") ? "employees"
      : user.permissions.includes("attendance.read") ? "attendance"
        : user.permissions.includes("overtime.read") ? "overtime"
        : (user.permissions.includes("leave.read") || user.permissions.includes("leave.balance.read")) ? "leave"
        : user.roles.includes("KT") && user.permissions.includes("payroll.components.read") ? "salary-components"
        : user.permissions.includes("accounts.manage") ? "accounts"
          : user.permissions.includes("period.read") ? "periods"
            : user.permissions.includes("settings.manage") ? "settings"
              : "organization";
}

function go(route: Route) {
  window.location.hash = "#/" + route;
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
    <main className="login-page" aria-labelledby="login-title">
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
          <Paragraph type="secondary">
            Sử dụng tài khoản được cấp để truy cập đúng phạm vi công việc.
          </Paragraph>
        </div>
        <Form
          form={form}
          layout="vertical"
          requiredMark="optional"
          onFinish={(values) => mutation.mutate(values)}
          disabled={mutation.isPending}
          autoComplete="on"
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
            <Input.Password autoComplete="current-password" />
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
        <Text type="secondary" className="login-note">
          Phiên làm việc được bảo vệ và tự hết hạn theo chính sách hệ thống.
        </Text>
      </section>
    </main>
  );
}

function Shell({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [route, setRoute] = useState(() => currentRoute(user));
  const [open, setOpen] = useState(false);
  const [passwordChangeOpen, setPasswordChangeOpen] = useState(false);
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
      ? { key: "employees", icon: <TeamOutlined />, label: "Nhân sự" }
      : null,
    accountManage
      ? { key: "accounts", icon: <UserOutlined />, label: "Tài khoản" }
      : null,
    periodRead
      ? { key: "periods", icon: <AuditOutlined />, label: "Kỳ công" }
      : null,
    settingsManage
      ? { key: "settings", icon: <BankOutlined />, label: "Thiết lập" }
      : null,
    user.permissions.includes("shift.read") ? { key: "shifts", icon: <CalendarOutlined />, label: "Ca & phân ca" } : null,
    attendanceRead ? { key: "attendance", icon: <CalendarOutlined />, label: "Chấm công" } : null,
    overtimeRead ? { key: "overtime", icon: <CalendarOutlined />, label: "Tăng ca (OT)" } : null,
    leaveRead ? { key: "leave", icon: <CalendarOutlined />, label: "Nghỉ & quỹ phép" } : null,
    user.roles.includes("KT") && user.permissions.includes("payroll.components.read") ? { key: "salary-components", icon: <BankOutlined />, label: "Cấu phần lương" } : null,
    { key: "organization", icon: <ApartmentOutlined />, label: "Tổ chức" },
    { key: "health", icon: <AuditOutlined />, label: "Hệ thống" },
  ].filter(Boolean) as { key: Route; icon: React.ReactNode; label: string }[];
  const navigate = (next: Route) => {
    setOpen(false);
    go(next);
  };
  const menu = (
    <Menu
      selectedKeys={[route]}
      items={items}
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
    ) : route === "organization" ? (
      <OrganizationPage />
    ) : (
      <SystemHealth />
    );
  return (
    <Layout className="app-shell">
      <a className="skip-link" href="#main">
        Đến nội dung chính
      </a>
      <Sider
        className="desktop-sider"
        width={240}
        breakpoint="lg"
        collapsedWidth={72}
        theme="light"
      >
        <div className="side-brand">
          <img src="/favicon.svg" alt="" width="32" height="32" />
          <span>HRTP</span>
        </div>
        {menu}
      </Sider>
      <Drawer
        className="mobile-nav"
        title="HRTP"
        placement="left"
        open={open}
        onClose={() => setOpen(false)}
        styles={{ body: { padding: 0 } }}
      >
        {menu}
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
            <Text type="secondary">{routeTitles[route]}</Text>
            <span aria-hidden="true">/</span>
            <strong>{scope}</strong>
          </div>
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
        </Header>
        <Content id="main" className="app-content">
          {body}
        </Content>
      </Layout>
    <PasswordChangeDialog open={passwordChangeOpen} onClose={() => setPasswordChangeOpen(false)} onSuccess={onLogout} />
    </Layout>
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
  return (
    <div className="content-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">HỒ SƠ / NHÂN SỰ</p>
          <Title level={1}>Danh sách nhân sự</Title>
          <Paragraph type="secondary">
            Chỉ hiển thị nhân sự thuộc phạm vi tài khoản được cấp.
          </Paragraph>
        </div>
        {canCreate && (
          <Button
            type="primary"
            size="large"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
          >
            Thêm nhân sự
          </Button>
        )}
      </div>
      <section className="panel filter-panel" aria-label="Bộ lọc nhân sự">
        <Input.Search
          aria-label="Tìm kiếm nhân sự"
          placeholder="Tìm theo mã hoặc họ tên"
          value={draftSearch}
          onChange={(event) => setDraftSearch(event.target.value)}
          onSearch={(value) => resetPage({ search: value.trim() })}
          enterButton={<SearchOutlined />}
          allowClear
        />
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
        <Select
          aria-label="Lọc theo trạng thái"
          placeholder="Tất cả trạng thái"
          value={status}
          allowClear
          options={[
            { value: "ACTIVE", label: "Đang làm việc" },
            { value: "TERMINATED", label: "Đã nghỉ việc" },
          ]}
          onChange={(value) => resetPage({ status: value })}
        />
      </section>
      <section
        className="panel table-panel"
        aria-label="Bảng danh sách nhân sự"
      >
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
                emptyText: <Empty description="Không có nhân sự phù hợp" />,
              }}
              onRow={(record) => ({
                onClick: () => setSelected(record),
                className: "clickable-row",
              })}
              pagination={false}
              scroll={{ x: 880 }}
              columns={[
                {
                  title: "Mã",
                  dataIndex: "code",
                  width: 130,
                  render: (value) => <Button type="link">{value}</Button>,
                },
                { title: "Họ và tên", dataIndex: "fullName", width: 210 },
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
                  render: (_, record) => record.jobTitle?.name ?? "—",
                },
                {
                  title: "Trạng thái",
                  dataIndex: "status",
                  width: 140,
                  render: (value) => (
                    <Tag color={value === "ACTIVE" ? "success" : "default"}>
                      {value === "ACTIVE" ? "Đang làm việc" : "Đã nghỉ việc"}
                    </Tag>
                  ),
                },
              ]}
            />
            <div className="table-footer">
              <Text type="secondary">
                {list.data ? "Tổng " + list.data.total + " nhân sự" : ""}
              </Text>
              <Pagination
                current={list.data?.page ?? page}
                pageSize={list.data?.pageSize ?? 20}
                total={list.data?.total ?? 0}
                showSizeChanger={false}
                onChange={(next) => setPage(next)}
              />
            </div>
          </>
        )}
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
          <Paragraph type="secondary">
            Đơn vị được hiển thị theo phạm vi quyền của tài khoản hiện tại.
          </Paragraph>
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
        <section className="panel table-panel">
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
      {user.requiresPasswordChange ? <ForcedPasswordChange onSuccess={end} /> : <Shell key={user.id} user={user} onLogout={end} />}
    </AntApp>
  ) : (
    <Login onLogin={establish} />
  );
}
