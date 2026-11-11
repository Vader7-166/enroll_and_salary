import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert, Button, Empty, Input, Select, Space, Spin, Tabs, Tag, Typography,
} from "antd";
import {
  ArrowRightOutlined, CalendarOutlined, CarryOutOutlined, FileProtectOutlined,
  ReconciliationOutlined, SearchOutlined, SettingOutlined,
} from "@ant-design/icons";
import type { AuthUser } from "../api/hrtp";
import { errorMessage } from "../api/client";
import { handbookApi } from "../api/handbook";
import type { HandbookArticle, HandbookCategory, HandbookKind } from "../api/handbook";

const { Title } = Typography;
const ROLE_NAMES: Record<string, string> = {
  TT: "Tổ trưởng", QD: "Quản đốc", KT: "Kế toán", AD: "Quản trị",
};
const CATEGORIES = [
  { key: "contracts", label: "Hợp đồng", icon: <FileProtectOutlined aria-hidden="true" /> },
  { key: "attendance", label: "Chấm công & tăng ca", icon: <CalendarOutlined aria-hidden="true" /> },
  { key: "leave", label: "Nghỉ phép", icon: <CarryOutOutlined aria-hidden="true" /> },
  { key: "payroll", label: "Tiền lương", icon: <ReconciliationOutlined aria-hidden="true" /> },
  { key: "administration", label: "Quản trị & bảo mật", icon: <SettingOutlined aria-hidden="true" /> },
] satisfies Array<{ key: HandbookCategory; label: string; icon: React.ReactNode }>;
const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gi, "d").toLowerCase();

function ArticleReader({ article, role, allowedRoutes, onNavigate }: {
  article: HandbookArticle;
  role: string;
  allowedRoutes: Set<string>;
  onNavigate: (route: string) => void;
}) {
  const actions = article.actions.filter((action, index, all) =>
    action.roles.includes(role) && allowedRoutes.has(action.route)
    && all.findIndex(other => other.route === action.route && other.roles.includes(role)) === index);
  const category = CATEGORIES.find(item => item.key === article.category)!;
  return <article className="panel handbook-reader" data-category={article.category} aria-labelledby="handbook-article-title">
    <header className="handbook-reader-header">
      <Space wrap size={[8, 8]}>
        <span className="handbook-category-label">{category.icon}{category.label}</span>
        <Tag color={article.label === "SIMULATION" ? "warning" : "success"}>
          {article.label === "SIMULATION" ? "Tham khảo · Mô phỏng" : "Đã đối chiếu tài liệu"}
        </Tag>
      </Space>
      <Title id="handbook-article-title" level={2}>{article.title}</Title>
    </header>
    <div className="handbook-reader-body">
      {article.overview && <section aria-labelledby="handbook-overview-title">
        <Title id="handbook-overview-title" level={3}>{article.kind === "guide" ? "Khi nào sử dụng" : "Phạm vi tham khảo"}</Title>
        {article.overview.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      </section>}
      {article.steps.length > 0 && <section aria-labelledby="handbook-steps-title">
        <Title id="handbook-steps-title" level={3}>{article.kind === "guide" ? "Các bước thực hiện" : "Nội dung chính sách tham khảo"}</Title>
        <ol className="handbook-steps">{article.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
      </section>}
      {article.notes.length > 0 && <section className="handbook-notes" aria-labelledby="handbook-notes-title">
        <Title id="handbook-notes-title" level={3}>Lưu ý</Title>
        <ul>{article.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
      </section>}
      {actions.length > 0 && <Space className="handbook-actions" wrap>
        {actions.map(action => <Button key={action.actionKey} type="primary" icon={<ArrowRightOutlined aria-hidden="true" />}
          onClick={() => onNavigate(action.route)}>Mở {action.label.split(" → ")[0]}</Button>)}
      </Space>}
      <section className="handbook-source" aria-label="Thông tin tài liệu và nguồn">
        <dl>
          <div><dt>Phiên bản nội dung</dt><dd>{article.version}</dd></div>
          <div><dt>Hiệu lực nguồn</dt><dd>{article.effectiveFrom ? `Từ ${article.effectiveFrom.split("-").reverse().join("/")}` : "Chưa xác nhận ngày hiệu lực"}
            {article.effectiveTo ? ` đến ${article.effectiveTo.split("-").reverse().join("/")}` : article.effectiveFrom ? " · Chưa ghi ngày kết thúc" : ""}</dd></div>
          <div className="handbook-source-wide"><dt>Phạm vi tài liệu</dt><dd>{article.scope}</dd></div>
          <div className="handbook-source-wide"><dt>Nguồn tham chiếu</dt><dd>{article.sourceReference}</dd></div>
        </dl>
      </section>
    </div>
  </article>;
}

export function HandbookWorkspace({ user, allowedRoutes, onNavigate }: {
  user: AuthUser;
  allowedRoutes: string[];
  onNavigate: (route: string) => void;
}) {
  const catalog = useQuery({
    queryKey: ["handbook", user.id, user.roles, user.permissions, user.assignments],
    queryFn: handbookApi.catalog,
    staleTime: 0,
  });
  const [kind, setKind] = useState<HandbookKind>("guide");
  const [requestedRole, setRequestedRole] = useState<string>(user.roles[0]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<HandbookCategory | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const roles = catalog.data?.roles ?? [];
  const role = roles.includes(requestedRole) ? requestedRole : roles[0];
  const routeSet = useMemo(() => new Set(allowedRoutes), [allowedRoutes]);
  const indexed = useMemo(() => (catalog.data?.items ?? []).map(article => ({
    article,
    searchText: fold([article.title, article.overview, ...article.steps, ...article.notes, ...article.keywords].join(" ")),
  })), [catalog.data]);
  const matching = useMemo(() => {
    const words = fold(search.trim()).split(/\s+/).filter(Boolean);
    return indexed.filter(item => item.article.kind === kind && item.article.roles.includes(role ?? "")
      && words.every(word => item.searchText.includes(word))).map(item => item.article);
  }, [indexed, kind, role, search]);
  const visible = matching.filter(article => category === "all" || article.category === category);
  const selected = visible.find(article => article.id === selectedId) ?? visible[0];
  const clearFilters = () => { setSearch(""); setCategory("all"); setSelectedId(null); };
  const changeKind = (next: string) => { setKind(next as HandbookKind); setCategory("all"); setSelectedId(null); };

  const content = <>
    <div className="handbook-filters">
      <div><label htmlFor="handbook-role">Vai trò</label><Select id="handbook-role" aria-label="Vai trò cẩm nang"
        value={role} disabled={!roles.length} placeholder="Chưa có vai trò"
        options={roles.map(value => ({ value, label: ROLE_NAMES[value] ?? value }))}
        onChange={value => { setRequestedRole(value); setCategory("all"); setSelectedId(null); }} /></div>
      <div><label htmlFor="handbook-search">Tìm trong cẩm nang</label><Input id="handbook-search" type="search" allowClear
        prefix={<SearchOutlined aria-hidden="true" />} placeholder="Bài viết, quy trình, chính sách…"
        value={search} onChange={event => setSearch(event.target.value)} /></div>
      <Button onClick={clearFilters}>Xóa lọc</Button>
    </div>
    <div className="handbook-result-count" role="status" aria-live="polite">{visible.length} bài phù hợp</div>
    <div className="handbook-layout">
      <aside className="handbook-navigation" aria-label="Tra cứu cẩm nang">
        <nav className="handbook-categories" aria-label="Danh mục cẩm nang">
          <Button className={category === "all" ? "is-selected" : ""} aria-pressed={category === "all"}
            onClick={() => { setCategory("all"); setSelectedId(null); }}><span>Tất cả danh mục</span><span>{matching.length}</span></Button>
          {CATEGORIES.map(item => <Button key={item.key} className={category === item.key ? "is-selected" : ""}
            aria-pressed={category === item.key} onClick={() => { setCategory(item.key); setSelectedId(null); }}>
            <span>{item.icon}{item.label}</span><span>{matching.filter(article => article.category === item.key).length}</span>
          </Button>)}
        </nav>
        <div className="handbook-mobile-pickers">
          <label htmlFor="handbook-category">Danh mục</label>
          <Select id="handbook-category" value={category} onChange={value => { setCategory(value); setSelectedId(null); }}
            options={[{ value: "all", label: "Tất cả danh mục" }, ...CATEGORIES.map(item => ({ value: item.key, label: item.label }))]} />
          <label htmlFor="handbook-article-picker">Bài viết</label>
          <Select id="handbook-article-picker" value={selected?.id} disabled={!visible.length} placeholder="Không có bài phù hợp"
            onChange={setSelectedId} options={visible.map(article => ({ value: article.id, label: article.title }))} />
        </div>
        {visible.length > 0 && <nav className="handbook-article-list" aria-label="Danh sách bài viết">
          {visible.map(article => <button key={article.id} type="button" className="handbook-article-button"
            aria-current={selected?.id === article.id ? "page" : undefined} onClick={() => setSelectedId(article.id)}>
            <span>{article.title}</span>
          </button>)}
        </nav>}
      </aside>
      {selected && role ? <ArticleReader article={selected} role={role} allowedRoutes={routeSet} onNavigate={onNavigate} /> :
        <div className="panel handbook-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={search || category !== "all" ? "Không có bài viết phù hợp bộ lọc." : "Chưa có tài liệu trong phạm vi vai trò này."}>
          {(search || category !== "all") && <Button onClick={clearFilters}>Xóa lọc</Button>}
        </Empty></div>}
    </div>
  </>;

  return <section className="content-stack handbook-workspace" aria-labelledby="handbook-title">
    <div className="page-heading"><div><Title id="handbook-title" level={1}>Cẩm nang & chính sách</Title></div></div>
    {catalog.isPending ? <div className="workspace-loading" role="status"><Spin />Đang tải cẩm nang…</div> :
      catalog.isError ? <Alert type="error" showIcon message="Không tải được cẩm nang" description={errorMessage(catalog.error)}
        action={<Button onClick={() => void catalog.refetch()} loading={catalog.isFetching}>Thử lại</Button>} /> :
        <Tabs activeKey={kind} onChange={changeKind} destroyOnHidden items={[
          { key: "guide", label: "Hướng dẫn sử dụng", children: kind === "guide" ? content : null },
          { key: "policy", label: "Chính sách & quy định", children: kind === "policy" ? content : null },
        ]} />}
  </section>;
}
