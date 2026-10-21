import { BadRequestException } from "@nestjs/common";
import Decimal from "decimal.js";

// Keep formula arithmetic independent of Decimal's process-wide configuration.
const Money = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP });
const LIMIT = new Money("1e30");
export type RoundingMode = "NONE" | "HALF_UP" | "HALF_EVEN" | "DOWN" | "UP" | "FLOOR" | "CEIL";
const rounding: Record<Exclude<RoundingMode, "NONE">, Decimal.Rounding> = {
  HALF_UP: Decimal.ROUND_HALF_UP, HALF_EVEN: Decimal.ROUND_HALF_EVEN,
  DOWN: Decimal.ROUND_DOWN, UP: Decimal.ROUND_UP, FLOOR: Decimal.ROUND_FLOOR, CEIL: Decimal.ROUND_CEIL,
};
function fail(code: string, message: string): never { throw new BadRequestException({ code, message }); }
function finite(value: Decimal): Decimal {
  if (!value.isFinite()) fail("FORMULA_NON_FINITE", "Phép tính không cho kết quả số hữu hạn.");
  return value;
}
function result(value: Decimal): Decimal {
  finite(value);
  if (value.abs().gte(LIMIT)) fail("FORMULA_RESULT_RANGE", "Kết quả vượt giới hạn 30 chữ số phần nguyên.");
  return value;
}
export function decimalValue(value: unknown, label = "Giá trị"): Decimal {
  if (typeof value !== "string" || !/^[+-]?\d{1,30}(?:\.\d{1,18})?$/.test(value))
    fail("FORMULA_DECIMAL_INVALID", `${label} phải là chuỗi số thập phân, tối đa 30 chữ số nguyên và 18 chữ số thập phân; không dùng ký pháp khoa học.`);
  return result(new Money(value));
}
export function roundFormula(value: Decimal, mode: RoundingMode, scale: number): Decimal {
  if (!Number.isInteger(scale) || scale < 0 || scale > 6 || (mode !== "NONE" && !Object.hasOwn(rounding, mode)))
    fail("FORMULA_ROUNDING_INVALID", "Chọn cách làm tròn và số chữ số thập phân từ 0 đến 6.");
  return result(mode === "NONE" ? new Money(value) : new Money(value).toDecimalPlaces(scale, rounding[mode]));
}

type Node =
  | { kind: "number"; value: Decimal }
  | { kind: "variable"; name: string }
  | { kind: "unary"; sign: string; child: Node }
  | { kind: "binary"; op: string; left: Node; right: Node }
  | { kind: "call"; name: string; args: Node[] };
interface Token { type: "number" | "name" | "operator" | "end"; text: string; at: number }
const precedence: Record<string, number> = { "<": 10, "<=": 10, ">": 10, ">=": 10, "==": 10, "!=": 10, "+": 20, "-": 20, "*": 30, "/": 30 };
const arities: Record<string, readonly [number, number]> = { MIN: [2, 16], MAX: [2, 16], ABS: [1, 1], IF: [3, 3], ROUND: [2, 2] };

class Parser {
  private cursor = 0;
  private count = 0;
  private token!: Token;
  private readonly lexer = /\s*(?:(\d+(?:\.\d+)?)|([A-Z][A-Z0-9_]*)|(<=|>=|==|!=|[+*/(),<>-]))/y;
  readonly symbols = new Set<string>();
  constructor(private readonly expression: string) { this.advance(); }
  private invalid(message: string): never { return fail("FORMULA_SYNTAX_INVALID", `${message} (vị trí ${this.token?.at ?? this.cursor + 1}).`); }
  private advance() {
    if (/^\s*$/.test(this.expression.slice(this.cursor))) { this.token = { type: "end", text: "", at: this.cursor + 1 }; return; }
    this.lexer.lastIndex = this.cursor;
    const match = this.lexer.exec(this.expression);
    if (!match) this.invalid("Biểu thức chứa ký tự hoặc tên không được phép");
    this.cursor = this.lexer.lastIndex;
    this.token = { type: match[1] ? "number" : match[2] ? "name" : "operator", text: match[1] ?? match[2] ?? match[3], at: match.index + 1 };
  }
  private node<T extends Node>(node: T): T {
    if (++this.count > 256) fail("FORMULA_COMPLEXITY_LIMIT", "Biểu thức vượt 256 nút tính toán.");
    return node;
  }
   private is(text: string) { return this.token.text === text; }
  private take(text: string) { if (this.token.text !== text) this.invalid(`Thiếu dấu ${text}`); this.advance(); }
  private parse(minimum = 0, depth = 0): Node {
    if (depth > 32) fail("FORMULA_COMPLEXITY_LIMIT", "Biểu thức lồng quá 32 cấp.");
    const first = this.token;
    let left: Node;
    if (first.type === "number") { left = this.node({ kind: "number", value: decimalValue(first.text, "Hằng số") }); this.advance(); }
    else if (first.text === "+" || first.text === "-") { this.advance(); left = this.node({ kind: "unary", sign: first.text, child: this.parse(40, depth + 1) }); }
    else if (first.text === "(") { this.advance(); left = this.parse(0, depth + 1); this.take(")"); }
    else if (first.type === "name") {
      if (first.text.length > 80) this.invalid("Tên biến vượt 80 ký tự");
      this.advance();
       if (this.is("(")) {
        const arity = arities[first.text];
        if (!Object.hasOwn(arities, first.text)) this.invalid("Chỉ dùng các hàm MIN, MAX, ABS, IF, ROUND");
        this.advance();
        const args: Node[] = [];
        if (this.token.text !== ")") {
          for (;;) { args.push(this.parse(0, depth + 1)); if (this.token.text !== ",") break; this.advance(); }
        }
        this.take(")");
        if (args.length < arity[0] || args.length > arity[1]) this.invalid("Số đối số hàm không hợp lệ");
        left = this.node({ kind: "call", name: first.text, args });
      } else { this.symbols.add(first.text); left = this.node({ kind: "variable", name: first.text }); }
    } else this.invalid("Cần số, biến hoặc biểu thức trong ngoặc");
    while (this.token.type === "operator") {
      const power = precedence[this.token.text];
      if (power === undefined || power < minimum) break;
      const op = this.token.text; this.advance();
      left = this.node({ kind: "binary", op, left, right: this.parse(power + 1, depth + 1) });
    }
    return left;
  }
  tree(): Node {
    const root = this.parse();
    if (this.token.type !== "end") this.invalid("Còn nội dung không hợp lệ sau biểu thức");
    const visit = (node: Node, depth: number) => {
      if (depth > 32) fail("FORMULA_COMPLEXITY_LIMIT", "Cây biểu thức lồng quá 32 cấp.");
      if (node.kind === "binary") { visit(node.left, depth + 1); visit(node.right, depth + 1); }
      else if (node.kind === "unary") visit(node.child, depth + 1);
      else if (node.kind === "call") for (const arg of node.args) visit(arg, depth + 1);
    };
    visit(root, 0);
    return root;
  }
}

function evaluate(node: Node, values: ReadonlyMap<string, Decimal.Value>): Decimal {
  if (node.kind === "number") return node.value;
  if (node.kind === "variable") {
    const value = values.get(node.name);
    if (value === undefined) fail("FORMULA_INPUT_MISSING", `Chưa có giá trị cho biến ${node.name}; không thay dữ liệu thiếu bằng 0.`);
    return Decimal.isDecimal(value) ? finite(new Money(value)) : decimalValue(value, node.name);
  }
  if (node.kind === "unary") { const value = evaluate(node.child, values); return node.sign === "-" ? value.negated() : value; }
  if (node.kind === "binary") {
    const a = evaluate(node.left, values), b = evaluate(node.right, values);
    switch (node.op) {
      case "+": return finite(a.plus(b));
      case "-": return finite(a.minus(b));
      case "*": return finite(a.times(b));
      case "/": if (b.isZero()) fail("FORMULA_DIVISION_BY_ZERO", "Không thể chia cho 0; kiểm tra dữ liệu mẫu và điều kiện công thức."); return finite(a.div(b));
      case "<": return new Money(a.lt(b) ? 1 : 0);
      case "<=": return new Money(a.lte(b) ? 1 : 0);
      case ">": return new Money(a.gt(b) ? 1 : 0);
      case ">=": return new Money(a.gte(b) ? 1 : 0);
      case "==": return new Money(a.eq(b) ? 1 : 0);
      case "!=": return new Money(!a.eq(b) ? 1 : 0);
    }
  }
  if (node.kind === "call") {
    // Do not evaluate the unused branch: IF(CONG_CHUAN == 0, 0, LUONG / CONG_CHUAN).
    if (node.name === "IF") return evaluate(node.args[evaluate(node.args[0], values).isZero() ? 2 : 1], values);
    const a = evaluate(node.args[0], values);
    if (node.name === "ABS") return a.abs();
    if (node.name === "ROUND") {
      const places = evaluate(node.args[1], values);
      if (!places.isInteger() || places.lt(-6) || places.gt(6)) fail("FORMULA_ROUNDING_INVALID", "ROUND cần số hàng nguyên từ -6 đến 6; luôn làm tròn nửa lên.");
      return finite(a.toNearest(new Money(10).pow(places.negated()), Decimal.ROUND_HALF_UP));
    }
    let chosen = a;
    for (let i = 1; i < node.args.length; i++) { const value = evaluate(node.args[i], values); if (node.name === "MIN" ? value.lt(chosen) : value.gt(chosen)) chosen = value; }
    return chosen;
  }
  return fail("FORMULA_SYNTAX_INVALID", "Phép tính không được hỗ trợ.");
}

export interface CompiledFormula {
  symbols: string[];
  evaluate(values: ReadonlyMap<string, Decimal.Value>): Decimal;
}
export function compileFormula(expression: string, declaredSymbols?: string[]): CompiledFormula {
  if (typeof expression !== "string" || !expression.trim() || expression.length > 2000)
    fail("FORMULA_SYNTAX_INVALID", "Nhập biểu thức từ 1 đến 2000 ký tự.");
  const parser = new Parser(expression), root = parser.tree(), symbols = [...parser.symbols];
  if (symbols.length > 32) fail("FORMULA_COMPLEXITY_LIMIT", "Công thức có tối đa 32 biến.");
  if (declaredSymbols) {
    const declared = new Set(declaredSymbols);
    if (declared.size !== declaredSymbols.length || declared.size > 32 || declaredSymbols.some(name => !/^[A-Z][A-Z0-9_]{0,79}$/.test(name)))
      fail("FORMULA_VARIABLES_INVALID", "Tên biến phải duy nhất, viết hoa, bắt đầu bằng chữ và tối đa 80 ký tự.");
    if (symbols.some(name => !declared.has(name)) || declaredSymbols.some(name => !parser.symbols.has(name)))
      fail("FORMULA_VARIABLES_INVALID", "Khai báo đủ và chỉ các biến được sử dụng trong biểu thức.");
  }
  return { symbols, evaluate: values => result(evaluate(root, values)) };
}
