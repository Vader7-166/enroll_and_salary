import { ApiOutlined, CheckCircleOutlined, CloseCircleOutlined, DatabaseOutlined, DesktopOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Descriptions, Spin, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { fetchHealth } from '../api/health';

const { Title, Paragraph, Text } = Typography;
type ConnectionState = 'up' | 'down' | 'pending' | 'unknown';

function Status({ state }: { state: ConnectionState }) {
  if (state === 'pending') return <Tag icon={<Spin size="small" />}>Đang kiểm tra</Tag>;
  if (state === 'unknown') return <Tag>Chưa xác minh</Tag>;
  return state === 'up' ? <Tag color="success" icon={<CheckCircleOutlined />}>Đã kết nối</Tag> : <Tag color="error" icon={<CloseCircleOutlined />}>Mất kết nối</Tag>;
}

function ConnectionRow({ icon, title, detail, state }: { icon: ReactNode; title: string; detail: string; state: ConnectionState }) {
  return <li className="connection-row"><span className="connection-icon" aria-hidden="true">{icon}</span><div className="connection-copy"><h3>{title}</h3><p>{detail}</p></div><Status state={state} /></li>;
}

export function SystemHealth() {
  const query = useQuery({ queryKey: ['health'], queryFn: ({ signal }) => fetchHealth(signal) });
  const result = query.isError ? undefined : query.data;
  const busy = query.isFetching;
  const healthy = result?.health.status === 'ok';
  const checkedAt = result ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(result.health.checkedAt)) : 'Chưa nhận được phản hồi';

  return <div className="content-stack">
    <div className="page-heading"><div><p className="eyebrow">HỆ THỐNG / KỸ THUẬT</p><Title level={1}>Kiểm tra kết nối</Title><Paragraph type="secondary">Xác minh kết nối từ website đến API và cơ sở dữ liệu.</Paragraph></div><Button type="primary" size="large" icon={<ReloadOutlined />} loading={busy} onClick={() => void query.refetch()}>Kiểm tra lại</Button></div>
    <div className="workspace-grid">
      <section className="panel connection-panel" aria-labelledby="connections-heading"><div className="panel-heading"><span className="section-index">01</span><div><Title level={2} id="connections-heading">Trạng thái kết nối</Title><Text type="secondary">Website → NestJS API → PostgreSQL</Text></div></div><div className="status-region" aria-live="polite" aria-busy={busy}><Alert showIcon type={busy ? 'info' : healthy ? 'success' : 'error'} message={busy ? 'Đang kiểm tra hệ thống' : healthy ? 'Kết nối thông suốt' : result ? 'API hoạt động, database chưa sẵn sàng' : 'Chưa kết nối được API'} description={busy ? 'Đang gửi yêu cầu đến API và truy vấn PostgreSQL.' : healthy ? 'API đã thực hiện thành công truy vấn SELECT 1 qua Prisma.' : result ? 'Kiểm tra PostgreSQL và DATABASE_URL trong backend/.env, sau đó kiểm tra lại.' : query.error instanceof Error ? query.error.message : 'Kiểm tra backend đang chạy và cấu hình proxy của Vite.'} /><ul className="connection-list"><ConnectionRow icon={<DesktopOutlined />} title="Website" detail="React · TypeScript · Vite" state="up" /><ConnectionRow icon={<ApiOutlined />} title="Backend API" detail={result && !busy ? 'NestJS · HTTP ' + result.httpStatus : 'NestJS · /api/health'} state={busy ? 'pending' : result ? 'up' : 'down'} /><ConnectionRow icon={<DatabaseOutlined />} title="Cơ sở dữ liệu" detail="PostgreSQL · Prisma · truy vấn thực tế" state={busy ? 'pending' : result ? result.health.database.status : 'unknown'} /></ul></div><div className="panel-footer"><span>Kiểm tra tại <strong>{checkedAt}</strong><span className="timezone"> (UTC+7)</span></span><Typography.Link href="/api/health" target="_blank" rel="noreferrer">Xem phản hồi API ↗</Typography.Link></div></section>
      <aside className="panel scope-panel" aria-labelledby="scope-heading"><p className="eyebrow">PHẠM VI HIỆN TẠI</p><Title level={2} id="scope-heading">Nền tảng chạy local</Title><Paragraph type="secondary">Trang kỹ thuật xác minh hạ tầng; các thao tác nhân sự và tài khoản được phân quyền riêng.</Paragraph><Descriptions column={1} size="small" layout="vertical" items={[{ key: 'architecture', label: 'Kiến trúc', children: 'Modular monolith' }, { key: 'data', label: 'Kết nối dữ liệu', children: 'PostgreSQL' }, { key: 'request', label: 'Giao tiếp', children: 'Cùng origin · /api qua Vite proxy' }, { key: 'client', label: 'Giao diện', children: 'Ant Design · TanStack Query' }]} /></aside>
    </div>
  </div>;
}
