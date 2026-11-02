import { Descriptions, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { TechnicalDetails } from "./TechnicalDetails";

const { Text } = Typography;

type RuleRow = { key: string; label: string; minutes: number };
type RuleValues = Record<string, unknown>;

const RULES: Array<{ key: string; label: string }> = [
  { key: "inBeforeMinutes", label: "Cửa sổ quẹt vào trước giờ ca" },
  { key: "inAfterMinutes", label: "Cửa sổ quẹt vào sau giờ ca" },
  { key: "outBeforeMinutes", label: "Cửa sổ quẹt ra trước giờ tan" },
  { key: "outAfterMinutes", label: "Cửa sổ quẹt ra sau giờ tan" },
  { key: "duplicateWindowMinutes", label: "Khoảng thời gian coi là quẹt trùng" },
];

function extractRules(value: unknown): { values: RuleValues; technical: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { values: {}, technical: value };
  const record = value as RuleValues;
  const values = record.values && typeof record.values === "object" && !Array.isArray(record.values)
    ? record.values as RuleValues
    : record;
  const unknownValues = Object.fromEntries(Object.entries(values).filter(([key]) => !RULES.some(rule => rule.key === key)));
  const technical = {
    parameterIds: record.parameterIds,
    unknownRules: unknownValues,
    other: Object.fromEntries(Object.entries(record).filter(([key]) => key !== "values" && key !== "parameterIds")),
  };
  return { values, technical };
}

export function AttendanceRulesView({ rules }: { rules: unknown }) {
  const { values, technical } = extractRules(rules);
  const rows: RuleRow[] = RULES.flatMap(rule => {
    const value = values[rule.key];
    return typeof value === "number" ? [{ key: rule.key, label: rule.label, minutes: value }] : [];
  });
  const columns: ColumnsType<RuleRow> = [
    { title: "Quy tắc", dataIndex: "label" },
    { title: "Thời lượng", dataIndex: "minutes", align: "right", width: 150, render: value => `${value.toLocaleString("vi-VN")} phút` },
  ];

  return <>
    {rows.length > 0
      ? <Table<RuleRow> rowKey="key" size="small" columns={columns} dataSource={rows} pagination={false} />
      : <Descriptions size="small" column={1}><Descriptions.Item label="Quy tắc"><Text type="secondary">Không có dữ liệu quy tắc.</Text></Descriptions.Item></Descriptions>}
    <TechnicalDetails title="Chi tiết kỹ thuật quy tắc"><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0 }}>{JSON.stringify(technical, null, 2)}</pre></TechnicalDetails>
  </>;
}
