import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { ApprovalActions } from "@/components/approval-actions";
import {
  UserCog,
  UserPlus,
  Plane,
  Clock,
  Wallet,
  Calculator,
  Download,
  AlertTriangle,
  Building,
  FileText,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";

const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("ar-SA", { style: "currency", currency: "SAR", maximumFractionDigits: 2 }).format(n || 0);

interface Employee {
  id: number;
  employeeNo: string;
  name: string;
  nameAr: string;
  nationalityType: string;
  status: string;
  departmentName: string | null;
  positionTitle: string | null;
  branchName: string | null;
  hireDate: string;
  iqamaExpiry: string | null;
  email: string | null;
  phone: string | null;
}

interface Department {
  id: number;
  name: string;
  nameAr: string;
  managerEmployeeId?: number | null;
}

interface Position {
  id: number;
  title: string;
  titleAr: string;
}

interface LeaveType {
  id: number;
  code: string;
  name: string;
  nameAr: string;
  defaultDaysPerYear: number;
  isPaid: boolean;
}

interface LeaveRequest {
  id: number;
  reference: string;
  employeeId: number;
  employeeName: string;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: string;
}

interface ExpenseClaim {
  id: number;
  reference: string;
  employeeId: number;
  claimDate: string;
  currency: string;
  amount: string;
  category: string | null;
  description: string | null;
  receiptUrl: string | null;
  status: string;
  approvedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

interface PayrollPeriod {
  id: number;
  name: string;
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  payDate: string;
  status: string;
}

interface PayrollRun {
  id: number;
  reference: string;
  periodName: string | null;
  status: string;
  totalGross: number;
  totalDeductions: number;
  totalGosiEmployee: number;
  totalGosiEmployer: number;
  totalNet: number;
  employeeCount: number;
  postedAt: string | null;
  paidAt: string | null;
  gosiRemittedAt: string | null;
}

interface ExpiryAlert {
  id: number;
  employeeId?: number;
  name: string;
  employeeNo: string;
  reference?: string;
  expiryDate: string;
  kind: "iqama" | "passport" | "contract";
  isOverdue: boolean;
}

interface SaudizationRow {
  branchId: number | null;
  branchName: string | null;
  total: number;
  saudis: number;
  nonSaudis: number;
  saudizationRatio: number;
  nitaqatBand: "platinum" | "green" | "yellow" | "red";
}

const STATUS_VARIANTS: Record<string, { label: string; cls: string }> = {
  active: { label: "نشط", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
  on_leave: { label: "في إجازة", cls: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  suspended: { label: "موقوف", cls: "bg-orange-500/10 text-orange-600 border-orange-500/30" },
  terminated: { label: "منهي", cls: "bg-rose-500/10 text-rose-600 border-rose-500/30" },
  pending: { label: "بانتظار", cls: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  approved: { label: "معتمد", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
  rejected: { label: "مرفوض", cls: "bg-rose-500/10 text-rose-600 border-rose-500/30" },
  draft: { label: "مسودة", cls: "bg-slate-500/10 text-slate-600 border-slate-500/30" },
  computed: { label: "محسوبة", cls: "bg-blue-500/10 text-blue-600 border-blue-500/30" },
  posted: { label: "مرحلة", cls: "bg-purple-500/10 text-purple-600 border-purple-500/30" },
  paid: { label: "مدفوعة", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
};

const NITAQAT_COLOR: Record<string, string> = {
  platinum: "bg-slate-300/20 text-slate-700 border-slate-400/30",
  green: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  yellow: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  red: "bg-rose-500/10 text-rose-600 border-rose-500/30",
};

function StatusBadge({ status }: { status: string }) {
  const v = STATUS_VARIANTS[status] ?? { label: status, cls: "" };
  return (
    <Badge variant="outline" className={v.cls}>
      {v.label}
    </Badge>
  );
}

export default function HrPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { has, canManageFinance } = usePermissions();
  const canWrite = has("hr");
  // Payroll create/post/mark-paid require finance role (server uses financeGuard).
  // HR-only users can manage employees but cannot post payroll journal entries.
  const canPayroll = canManageFinance;

  // -------------------- Queries --------------------
  const employeesQ = useQuery<Employee[]>({
    queryKey: ["hr", "employees"],
    queryFn: () => api<Employee[]>("/hr/employees"),
  });
  const departmentsQ = useQuery<Department[]>({
    queryKey: ["hr", "departments"],
    queryFn: () => api<Department[]>("/hr/departments"),
  });
  const positionsQ = useQuery<Position[]>({
    queryKey: ["hr", "positions"],
    queryFn: () => api<Position[]>("/hr/positions"),
  });
  const leaveTypesQ = useQuery<LeaveType[]>({
    queryKey: ["hr", "leave-types"],
    queryFn: () => api<LeaveType[]>("/hr/leave-types"),
  });
  const leaveReqsQ = useQuery<LeaveRequest[]>({
    queryKey: ["hr", "leave-requests"],
    queryFn: () => api<LeaveRequest[]>("/hr/leave-requests"),
  });
  const expenseClaimsQ = useQuery<ExpenseClaim[]>({
    queryKey: ["hr", "expense-claims"],
    queryFn: () => api<ExpenseClaim[]>("/hr/expense-claims"),
  });
  const periodsQ = useQuery<PayrollPeriod[]>({
    queryKey: ["hr", "payroll-periods"],
    queryFn: () => api<PayrollPeriod[]>("/hr/payroll-periods"),
  });
  const runsQ = useQuery<PayrollRun[]>({
    queryKey: ["hr", "payroll-runs"],
    queryFn: () => api<PayrollRun[]>("/hr/payroll-runs"),
  });
  const expiryQ = useQuery<ExpiryAlert[]>({
    queryKey: ["hr", "expiry"],
    queryFn: () => api<ExpiryAlert[]>("/hr/expiry-alerts?days=90"),
  });
  const saudiQ = useQuery<SaudizationRow[]>({
    queryKey: ["hr", "saudization"],
    queryFn: () => api<SaudizationRow[]>("/hr/reports/saudization"),
  });

  // Attendance summary range (defaults to current month).
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  const [attRange, setAttRange] = useState({ from: monthStart, to: monthEnd });
  const attendanceQ = useQuery<Array<{
    employeeId: number; employeeName: string; employeeNo: string; shiftName: string;
    workingDays: number; presentDays: number; absentDays: number;
    lateMinutes: number; earlyLeaveMinutes: number; overtimeHours: number;
  }>>({
    queryKey: ["hr", "attendance-summary", attRange.from, attRange.to],
    queryFn: () => api(`/hr/attendance/summary?from=${attRange.from}&to=${attRange.to}`),
  });

  type OrgNode = {
    id: number; name: string; parentId: number | null;
    managerEmployeeId: number | null; managerName: string | null;
    headcount: number; children: OrgNode[];
  };
  const orgQ = useQuery<OrgNode[]>({
    queryKey: ["hr", "org-chart"],
    queryFn: () => api<OrgNode[]>("/hr/org-chart"),
  });

  // Shifts management.
  type Shift = {
    id: number; name: string; nameAr: string;
    startTime: string; endTime: string;
    breakMinutes: number; workingDays: string; isActive: boolean;
  };
  const shiftsQ = useQuery<Shift[]>({
    queryKey: ["hr", "shifts"],
    queryFn: () => api<Shift[]>("/hr/shifts"),
  });
  const [newShift, setNewShift] = useState({
    name: "", nameAr: "", startTime: "09:00", endTime: "17:00",
    breakMinutes: 60, workingDays: "0,1,2,3,4",
  });
  const createShiftMut = useMutation({
    mutationFn: () =>
      api("/hr/shifts", { method: "POST", body: JSON.stringify(newShift) }),
    onSuccess: () => {
      toast({ title: "تم إنشاء الوردية" });
      setNewShift({ name: "", nameAr: "", startTime: "09:00", endTime: "17:00", breakMinutes: 60, workingDays: "0,1,2,3,4" });
      void qc.invalidateQueries({ queryKey: ["hr", "shifts"] });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "خطأ", description: err.message }),
  });
  const [assignShift, setAssignShift] = useState({
    employeeId: 0, shiftId: 0, effectiveFrom: monthStart,
  });
  const assignShiftMut = useMutation({
    mutationFn: () =>
      api("/hr/employee-shifts", { method: "POST", body: JSON.stringify(assignShift) }),
    onSuccess: () => {
      toast({ title: "تم تعيين الوردية للموظف" });
      void qc.invalidateQueries({ queryKey: ["hr"] });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "خطأ", description: err.message }),
  });

  // Lightweight contract listing for component manager dropdown.
  type ContractLite = { id: number; reference: string; employeeId: number };
  const contractsQ = useQuery<ContractLite[]>({
    queryKey: ["hr", "contracts-list"],
    queryFn: () => api<ContractLite[]>("/hr/contracts"),
  });

  // Salary components per contract.
  type SalaryComponent = {
    id: number; contractId: number; name: string; nameAr: string;
    kind: "earning" | "deduction"; amount: number;
    includeInGosi: boolean; isActive: boolean;
  };
  const [selectedContractId, setSelectedContractId] = useState<number>(0);
  const componentsQ = useQuery<SalaryComponent[]>({
    queryKey: ["hr", "components", selectedContractId],
    queryFn: () => api<SalaryComponent[]>(`/hr/contracts/${selectedContractId}/components`),
    enabled: selectedContractId > 0,
  });
  const [newComp, setNewComp] = useState({
    name: "", nameAr: "", kind: "earning" as "earning" | "deduction",
    amount: 0, includeInGosi: false,
  });
  const createCompMut = useMutation({
    mutationFn: () =>
      api("/hr/salary-components", {
        method: "POST",
        body: JSON.stringify({ ...newComp, contractId: selectedContractId }),
      }),
    onSuccess: () => {
      toast({ title: "تم إضافة العنصر" });
      setNewComp({ name: "", nameAr: "", kind: "earning", amount: 0, includeInGosi: false });
      void qc.invalidateQueries({ queryKey: ["hr", "components"] });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "خطأ", description: err.message }),
  });
  const deleteCompMut = useMutation({
    mutationFn: (id: number) => api(`/hr/salary-components/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["hr", "components"] }),
  });

  // Payslip listing (visible to all roles; server filters per permission).
  type Payslip = {
    id: number; reference: string; employeeId: number; employeeName: string;
    runId: number; runReference: string; periodName: string; netPay: number; createdAt: string;
  };
  const payslipsQ = useQuery<Payslip[]>({
    queryKey: ["hr", "payslips"],
    queryFn: () => api<Payslip[]>("/hr/payslips"),
  });

  // -------------------- Mutations --------------------
  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ["hr"] });
  };

  const createEmployee = useMutation({
    mutationFn: (b: Record<string, unknown>) =>
      api("/hr/employees", { method: "POST", body: JSON.stringify(b) }),
    onSuccess: () => {
      toast({ title: "تم إضافة الموظف" });
      refreshAll();
      setEmpOpen(false);
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  const createDept = useMutation({
    mutationFn: (b: Record<string, unknown>) =>
      api("/hr/departments", { method: "POST", body: JSON.stringify(b) }),
    onSuccess: () => {
      toast({ title: "تم إضافة الإدارة" });
      refreshAll();
      setDeptOpen(false);
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  const createContract = useMutation({
    mutationFn: (b: Record<string, unknown>) =>
      api("/hr/contracts", { method: "POST", body: JSON.stringify(b) }),
    onSuccess: () => {
      toast({ title: "تم إنشاء العقد" });
      refreshAll();
      setContractOpen(false);
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  const createLeave = useMutation({
    mutationFn: (b: Record<string, unknown>) =>
      api("/hr/leave-requests", { method: "POST", body: JSON.stringify(b) }),
    onSuccess: () => {
      toast({ title: "تم إنشاء طلب الإجازة" });
      refreshAll();
      setLeaveOpen(false);
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  const decideLeave = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "approve" | "reject" }) =>
      api(`/hr/leave-requests/${id}/decide`, { method: "POST", body: JSON.stringify({ action }) }),
    onSuccess: () => {
      toast({ title: "تم تحديث الطلب" });
      refreshAll();
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  const createExpenseClaim = useMutation({
    mutationFn: (b: Record<string, unknown>) =>
      api("/hr/expense-claims", { method: "POST", body: JSON.stringify(b) }),
    onSuccess: () => {
      toast({ title: "تم إنشاء مطالبة المصروف" });
      refreshAll();
      setExpenseOpen(false);
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  const createPeriod = useMutation({
    mutationFn: (b: { year: number; month: number }) =>
      api("/hr/payroll-periods", { method: "POST", body: JSON.stringify(b) }),
    onSuccess: () => {
      toast({ title: "تم إنشاء فترة الرواتب" });
      refreshAll();
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  const computeRun = useMutation({
    mutationFn: (periodId: number) =>
      api("/hr/payroll-runs", { method: "POST", body: JSON.stringify({ periodId }) }),
    onSuccess: () => {
      toast({ title: "تم احتساب الرواتب" });
      refreshAll();
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  const postRun = useMutation({
    mutationFn: (id: number) => api(`/hr/payroll-runs/${id}/post`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "تم ترحيل الرواتب إلى المحاسبة" });
      refreshAll();
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  const markPaid = useMutation({
    mutationFn: (id: number) => api(`/hr/payroll-runs/${id}/mark-paid`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "تم تسجيل الدفع" });
      refreshAll();
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });
  const remitGosi = useMutation({
    mutationFn: (id: number) => api(`/hr/payroll-runs/${id}/remit-gosi`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "تم تحويل التأمينات" });
      refreshAll();
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  // -------------------- Dialog state --------------------
  const [empOpen, setEmpOpen] = useState(false);
  const [empForm, setEmpForm] = useState({
    name: "",
    nameAr: "",
    nationalityType: "saudi",
    nationality: "SA",
    nationalId: "",
    iqamaExpiry: "",
    email: "",
    phone: "",
    departmentId: "",
    positionId: "",
    hireDate: new Date().toISOString().slice(0, 10),
    bankIban: "",
  });

  const [deptOpen, setDeptOpen] = useState(false);
  const [deptForm, setDeptForm] = useState({ name: "", nameAr: "", managerEmployeeId: "" });
  const updateDeptManager = useMutation({
    mutationFn: (b: { id: number; managerEmployeeId: number | null }) =>
      api(`/hr/departments/${b.id}`, {
        method: "PUT",
        body: JSON.stringify({ managerEmployeeId: b.managerEmployeeId }),
      }),
    onSuccess: () => {
      toast({ title: "تم تحديث مدير الإدارة" });
      void qc.invalidateQueries({ queryKey: ["hr"] });
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  // ---- Operations tab state ----
  type LeaveBalance = {
    id: number; employeeId: number; leaveTypeCode: string; leaveTypeName: string;
    year: number; entitlement: number; used: number; pending: number; remaining: number;
  };
  const [opsEmployeeId, setOpsEmployeeId] = useState<string>("");
  const balancesQ = useQuery<LeaveBalance[]>({
    queryKey: ["hr", "leave-balances", opsEmployeeId],
    queryFn: () =>
      api<LeaveBalance[]>(
        `/hr/leave-balances${opsEmployeeId ? `?employeeId=${opsEmployeeId}` : ""}`,
      ),
  });
  type CalendarEntry = {
    id: number; reference: string; employeeId: number; employeeName: string;
    leaveTypeCode: string; leaveTypeName: string; startDate: string; endDate: string;
    days: number; status: string;
  };
  const [calRange, setCalRange] = useState({ from: monthStart, to: monthEnd });
  const calendarQ = useQuery<CalendarEntry[]>({
    queryKey: ["hr", "leaves-calendar", calRange.from, calRange.to],
    queryFn: () =>
      api<CalendarEntry[]>(`/hr/leaves/calendar?from=${calRange.from}&to=${calRange.to}`),
  });
  type Loan = {
    id: number; employeeId: number; employeeName?: string;
    principal: number; remaining: number; monthlyInstallment: number;
    startDate: string; status: string;
  };
  const loansQ = useQuery<Loan[]>({
    queryKey: ["hr", "loans"],
    queryFn: () => api<Loan[]>("/hr/loans"),
  });
  const [loanForm, setLoanForm] = useState({
    employeeId: "", principal: "", monthlyInstallment: "",
    startDate: new Date().toISOString().slice(0, 10), reason: "",
  });
  const createLoan = useMutation({
    mutationFn: () =>
      api("/hr/loans", {
        method: "POST",
        body: JSON.stringify({
          employeeId: Number(loanForm.employeeId),
          principal: Number(loanForm.principal),
          monthlyInstallment: Number(loanForm.monthlyInstallment),
          startDate: loanForm.startDate,
          reason: loanForm.reason || undefined,
        }),
      }),
    onSuccess: () => {
      toast({ title: "تم إضافة القرض" });
      setLoanForm({ employeeId: "", principal: "", monthlyInstallment: "",
        startDate: new Date().toISOString().slice(0, 10), reason: "" });
      void qc.invalidateQueries({ queryKey: ["hr", "loans"] });
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  type EmployeeDoc = {
    id: number; employeeId: number; docType: string; reference: string | null;
    fileUrl: string | null; expiresOn: string | null; uploadedAt: string;
  };
  const [docEmpId, setDocEmpId] = useState<string>("");
  const docsQ = useQuery<EmployeeDoc[]>({
    queryKey: ["hr", "documents", docEmpId],
    queryFn: () => api<EmployeeDoc[]>(`/hr/employees/${docEmpId}/documents`),
    enabled: docEmpId.length > 0,
  });
  const [docForm, setDocForm] = useState({
    docType: "iqama", reference: "", fileUrl: "", expiresOn: "",
  });
  const createDoc = useMutation({
    mutationFn: () =>
      api("/hr/employee-documents", {
        method: "POST",
        body: JSON.stringify({
          employeeId: Number(docEmpId),
          docType: docForm.docType,
          reference: docForm.reference || null,
          fileUrl: docForm.fileUrl || null,
          expiresOn: docForm.expiresOn || null,
        }),
      }),
    onSuccess: () => {
      toast({ title: "تم حفظ الوثيقة" });
      setDocForm({ docType: "iqama", reference: "", fileUrl: "", expiresOn: "" });
      void qc.invalidateQueries({ queryKey: ["hr", "documents"] });
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  type GosiSetting = {
    id: number; effectiveFrom: string; saudiEmployeeRate: number;
    saudiEmployerRate: number; nonSaudiEmployerRate: number; salaryCeiling: number;
  };
  const gosiQ = useQuery<GosiSetting[]>({
    queryKey: ["hr", "gosi-settings"],
    queryFn: () => api<GosiSetting[]>("/hr/gosi-settings"),
  });
  const [gosiForm, setGosiForm] = useState({
    effectiveFrom: new Date().toISOString().slice(0, 10),
    saudiEmployeeRate: "9.75", saudiEmployerRate: "11.75",
    nonSaudiEmployerRate: "2", salaryCeiling: "45000",
  });
  const createGosi = useMutation({
    mutationFn: () =>
      api("/hr/gosi-settings", {
        method: "POST",
        body: JSON.stringify({
          effectiveFrom: gosiForm.effectiveFrom,
          saudiEmployeeRate: Number(gosiForm.saudiEmployeeRate),
          saudiEmployerRate: Number(gosiForm.saudiEmployerRate),
          nonSaudiEmployerRate: Number(gosiForm.nonSaudiEmployerRate),
          salaryCeiling: Number(gosiForm.salaryCeiling),
        }),
      }),
    onSuccess: () => {
      toast({ title: "تم تحديث إعدادات GOSI" });
      void qc.invalidateQueries({ queryKey: ["hr", "gosi-settings"] });
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  // EOS calculator
  type EosResult = {
    employee: { employeeNo: string; nameAr: string; hireDate: string };
    asOf: string; reason: string; yearsOfService: number; monthlyBasic: number;
    gratuityFull: number; reductionFactor: number; payable: number;
  };
  const [eosForm, setEosForm] = useState({
    employeeId: "", reason: "termination" as "termination" | "resignation",
    asOf: new Date().toISOString().slice(0, 10),
  });
  const [eosResult, setEosResult] = useState<EosResult | null>(null);
  const eosCalc = useMutation({
    mutationFn: () =>
      api<EosResult>(
        `/hr/employees/${eosForm.employeeId}/eos-estimate?reason=${eosForm.reason}&asOf=${eosForm.asOf}`,
      ),
    onSuccess: (r) => setEosResult(r),
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  // Punch entry
  const [punchForm, setPunchForm] = useState({
    employeeId: "", punchAt: new Date().toISOString().slice(0, 16), kind: "in" as "in" | "out",
  });
  const createPunch = useMutation({
    mutationFn: () =>
      api("/hr/attendance/punch", {
        method: "POST",
        body: JSON.stringify({
          employeeId: Number(punchForm.employeeId),
          punchAt: new Date(punchForm.punchAt).toISOString(),
          kind: punchForm.kind,
          source: "manual",
        }),
      }),
    onSuccess: () => {
      toast({ title: "تم تسجيل الحضور" });
      void qc.invalidateQueries({ queryKey: ["hr", "attendance-summary"] });
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  // Payroll register report
  const [registerRunId, setRegisterRunId] = useState<string>("");
  type PayrollRegister = {
    run: { reference: string; status: string };
    period: { name: string; payDate: string } | null;
    employees: number;
    totals: Record<string, number>;
    detail: Array<{
      employeeNo: string; employeeName: string; grossPay: number;
      gosiEmployee: number; totalDeductions: number; netPay: number;
    }>;
  };
  const registerQ = useQuery<PayrollRegister>({
    queryKey: ["hr", "payroll-register", registerRunId],
    queryFn: () => api<PayrollRegister>(`/hr/reports/payroll-register?runId=${registerRunId}`),
    enabled: registerRunId.length > 0,
  });

  // GOSI report per period
  const [gosiRunId, setGosiRunId] = useState<string>("");
  type GosiReport = {
    run: { reference: string; status: string };
    totals: { gosiBase: number; gosiEmployee: number; gosiEmployer: number; total: number };
    employees: Array<{
      employeeNo: string; employeeName: string; nationalityType: string;
      gosiBase: number; gosiEmployee: number; gosiEmployer: number;
    }>;
  };
  const gosiReportQ = useQuery<GosiReport>({
    queryKey: ["hr", "gosi-report", gosiRunId],
    queryFn: () => api<GosiReport>(`/hr/reports/gosi?runId=${gosiRunId}`),
    enabled: gosiRunId.length > 0,
  });

  const [contractOpen, setContractOpen] = useState(false);
  const [contractForm, setContractForm] = useState({
    employeeId: "",
    contractType: "saudi",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: "",
    basicSalary: "",
    housingAllowance: "",
    transportAllowance: "",
    gosiApplies: true,
  });

  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState({
    employeeId: "",
    leaveTypeId: "",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    reason: "",
  });

  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    employeeId: "",
    claimDate: new Date().toISOString().slice(0, 10),
    currency: "SAR",
    amount: "",
    category: "",
    description: "",
    receiptUrl: "",
  });

  const [newPeriod, setNewPeriod] = useState({
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
  });

  // -------------------- Render --------------------
  return (
    <div className="space-y-6 p-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500/15 to-emerald-500/15 text-teal-600">
            <UserCog className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">الموارد البشرية والرواتب</h1>
            <p className="text-sm text-muted-foreground">
              إدارة الموظفين، العقود، الإجازات، الحضور، ورواتب نظام حماية الأجور (WPS) وفق نظام العمل السعودي
            </p>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <KpiCard
          title="إجمالي الموظفين"
          value={String(employeesQ.data?.length ?? 0)}
          icon={<UserCog className="h-5 w-5" />}
          color="teal"
        />
        <KpiCard
          title="موظفون نشطون"
          value={String(employeesQ.data?.filter((e) => e.status === "active").length ?? 0)}
          icon={<CheckCircle2 className="h-5 w-5" />}
          color="emerald"
        />
        <KpiCard
          title="طلبات إجازات معلقة"
          value={String(leaveReqsQ.data?.filter((r) => r.status === "pending").length ?? 0)}
          icon={<Plane className="h-5 w-5" />}
          color="amber"
        />
        <KpiCard
          title="تنبيهات انتهاء (90 يوم)"
          value={String(expiryQ.data?.length ?? 0)}
          icon={<AlertTriangle className="h-5 w-5" />}
          color="rose"
        />
      </div>

      <Tabs defaultValue="employees" className="space-y-4">
        <TabsList className="flex w-full flex-wrap gap-1">
          <TabsTrigger value="employees">الموظفون</TabsTrigger>
          <TabsTrigger value="departments">الإدارات</TabsTrigger>
          <TabsTrigger value="orgchart">الهيكل التنظيمي</TabsTrigger>
          <TabsTrigger value="contracts">العقود</TabsTrigger>
          <TabsTrigger value="leaves">الإجازات</TabsTrigger>
          <TabsTrigger value="expenses">مطالبات المصروفات</TabsTrigger>
          <TabsTrigger value="attendance">الحضور</TabsTrigger>
          <TabsTrigger value="settings">الورديات والبدلات</TabsTrigger>
          <TabsTrigger value="payroll">الرواتب</TabsTrigger>
          <TabsTrigger value="payslips">بيانات الرواتب</TabsTrigger>
          <TabsTrigger value="alerts">التنبيهات</TabsTrigger>
          <TabsTrigger value="reports">التقارير</TabsTrigger>
          <TabsTrigger value="ops">العمليات</TabsTrigger>
        </TabsList>

        {/* ----- Employees ----- */}
        <TabsContent value="employees">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>قائمة الموظفين</CardTitle>
              {canWrite && (
                <Dialog open={empOpen} onOpenChange={setEmpOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <UserPlus className="ml-2 h-4 w-4" /> إضافة موظف
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>إضافة موظف جديد</DialogTitle>
                    </DialogHeader>
                    <div className="grid grid-cols-2 gap-4 py-2">
                      <Field label="الاسم بالعربية">
                        <Input
                          value={empForm.nameAr}
                          onChange={(e) => setEmpForm({ ...empForm, nameAr: e.target.value })}
                        />
                      </Field>
                      <Field label="Name (English)">
                        <Input
                          value={empForm.name}
                          onChange={(e) => setEmpForm({ ...empForm, name: e.target.value })}
                        />
                      </Field>
                      <Field label="نوع الجنسية">
                        <Select
                          value={empForm.nationalityType}
                          onValueChange={(v) => setEmpForm({ ...empForm, nationalityType: v })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="saudi">سعودي</SelectItem>
                            <SelectItem value="iqama">مقيم (إقامة)</SelectItem>
                            <SelectItem value="gcc">خليجي</SelectItem>
                            <SelectItem value="contractor">متعاقد</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="رقم الهوية / الإقامة">
                        <Input
                          value={empForm.nationalId}
                          onChange={(e) => setEmpForm({ ...empForm, nationalId: e.target.value })}
                        />
                      </Field>
                      <Field label="انتهاء الإقامة">
                        <Input
                          type="date"
                          value={empForm.iqamaExpiry}
                          onChange={(e) => setEmpForm({ ...empForm, iqamaExpiry: e.target.value })}
                        />
                      </Field>
                      <Field label="تاريخ التعيين">
                        <Input
                          type="date"
                          value={empForm.hireDate}
                          onChange={(e) => setEmpForm({ ...empForm, hireDate: e.target.value })}
                        />
                      </Field>
                      <Field label="البريد الإلكتروني">
                        <Input
                          type="email"
                          value={empForm.email}
                          onChange={(e) => setEmpForm({ ...empForm, email: e.target.value })}
                        />
                      </Field>
                      <Field label="الجوال">
                        <Input
                          value={empForm.phone}
                          onChange={(e) => setEmpForm({ ...empForm, phone: e.target.value })}
                        />
                      </Field>
                      <Field label="الإدارة">
                        <Select
                          value={empForm.departmentId}
                          onValueChange={(v) => setEmpForm({ ...empForm, departmentId: v })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="اختر..." />
                          </SelectTrigger>
                          <SelectContent>
                            {(departmentsQ.data ?? []).map((d) => (
                              <SelectItem key={d.id} value={String(d.id)}>
                                {d.nameAr}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="الوظيفة">
                        <Select
                          value={empForm.positionId}
                          onValueChange={(v) => setEmpForm({ ...empForm, positionId: v })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="اختر..." />
                          </SelectTrigger>
                          <SelectContent>
                            {(positionsQ.data ?? []).map((p) => (
                              <SelectItem key={p.id} value={String(p.id)}>
                                {p.titleAr}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="رقم IBAN" className="col-span-2">
                        <Input
                          value={empForm.bankIban}
                          onChange={(e) => setEmpForm({ ...empForm, bankIban: e.target.value })}
                          placeholder="SA00..."
                        />
                      </Field>
                    </div>
                    <DialogFooter>
                      <Button
                        onClick={() => {
                          const payload: Record<string, unknown> = { ...empForm };
                          for (const k of Object.keys(payload)) {
                            if (payload[k] === "" || payload[k] === null) delete payload[k];
                          }
                          if (payload.departmentId) payload.departmentId = Number(payload.departmentId);
                          if (payload.positionId) payload.positionId = Number(payload.positionId);
                          createEmployee.mutate(payload);
                        }}
                        disabled={createEmployee.isPending}
                      >
                        {createEmployee.isPending && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
                        حفظ
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الرقم الوظيفي</TableHead>
                    <TableHead>الاسم</TableHead>
                    <TableHead>الإدارة</TableHead>
                    <TableHead>الوظيفة</TableHead>
                    <TableHead>الجنسية</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>تاريخ التعيين</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(employeesQ.data ?? []).map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-mono text-xs">{e.employeeNo}</TableCell>
                      <TableCell className="font-medium">{e.nameAr}</TableCell>
                      <TableCell>{e.departmentName ?? "—"}</TableCell>
                      <TableCell>{e.positionTitle ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {e.nationalityType === "saudi" ? "سعودي" : e.nationalityType === "iqama" ? "مقيم" : e.nationalityType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={e.status} />
                      </TableCell>
                      <TableCell>{e.hireDate}</TableCell>
                    </TableRow>
                  ))}
                  {employeesQ.data?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        لا يوجد موظفون مسجلون بعد
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----- Departments ----- */}
        <TabsContent value="departments">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>الإدارات والأقسام</CardTitle>
              {canWrite && (
                <Dialog open={deptOpen} onOpenChange={setDeptOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Building className="ml-2 h-4 w-4" /> إضافة إدارة
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>إدارة جديدة</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                      <Field label="الاسم بالعربية">
                        <Input
                          value={deptForm.nameAr}
                          onChange={(e) => setDeptForm({ ...deptForm, nameAr: e.target.value })}
                        />
                      </Field>
                      <Field label="Name (English)">
                        <Input
                          value={deptForm.name}
                          onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
                        />
                      </Field>
                      <Field label="مدير الإدارة">
                        <Select
                          value={deptForm.managerEmployeeId}
                          onValueChange={(v) =>
                            setDeptForm({ ...deptForm, managerEmployeeId: v === "none" ? "" : v })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="بدون مدير" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">بدون مدير</SelectItem>
                            {(employeesQ.data ?? []).map((e) => (
                              <SelectItem key={e.id} value={String(e.id)}>
                                {e.nameAr} ({e.employeeNo})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                    <DialogFooter>
                      <Button
                        onClick={() =>
                          createDept.mutate({
                            name: deptForm.name,
                            nameAr: deptForm.nameAr,
                            managerEmployeeId: deptForm.managerEmployeeId
                              ? Number(deptForm.managerEmployeeId)
                              : null,
                          })
                        }
                        disabled={createDept.isPending}
                      >
                        حفظ
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-3">
                {(departmentsQ.data ?? []).map((d) => (
                  <div key={d.id} className="space-y-2 rounded-lg border p-3">
                    <div className="flex items-center gap-3">
                      <Building className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <div className="font-medium">{d.nameAr}</div>
                        <div className="text-xs text-muted-foreground">{d.name}</div>
                      </div>
                    </div>
                    {canWrite && (
                      <Select
                        value={d.managerEmployeeId ? String(d.managerEmployeeId) : "none"}
                        onValueChange={(v) =>
                          updateDeptManager.mutate({
                            id: d.id,
                            managerEmployeeId: v === "none" ? null : Number(v),
                          })
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="تعيين مدير" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">بدون مدير</SelectItem>
                          {(employeesQ.data ?? []).map((e) => (
                            <SelectItem key={e.id} value={String(e.id)}>
                              {e.nameAr} ({e.employeeNo})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                ))}
                {departmentsQ.data?.length === 0 && (
                  <p className="col-span-3 text-center text-sm text-muted-foreground">لا توجد إدارات</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----- Contracts ----- */}
        <TabsContent value="contracts">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>العقود</CardTitle>
              {canWrite && (
                <Dialog open={contractOpen} onOpenChange={setContractOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <FileText className="ml-2 h-4 w-4" /> عقد جديد
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>عقد عمل جديد</DialogTitle>
                    </DialogHeader>
                    <div className="grid grid-cols-2 gap-4 py-2">
                      <Field label="الموظف" className="col-span-2">
                        <Select
                          value={contractForm.employeeId}
                          onValueChange={(v) => setContractForm({ ...contractForm, employeeId: v })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="اختر موظف" />
                          </SelectTrigger>
                          <SelectContent>
                            {(employeesQ.data ?? []).map((e) => (
                              <SelectItem key={e.id} value={String(e.id)}>
                                {e.nameAr} ({e.employeeNo})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="نوع العقد">
                        <Select
                          value={contractForm.contractType}
                          onValueChange={(v) => setContractForm({ ...contractForm, contractType: v })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="saudi">سعودي</SelectItem>
                            <SelectItem value="iqama">مقيم</SelectItem>
                            <SelectItem value="gcc">خليجي</SelectItem>
                            <SelectItem value="contractor">متعاقد</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="تاريخ البداية">
                        <Input
                          type="date"
                          value={contractForm.startDate}
                          onChange={(e) => setContractForm({ ...contractForm, startDate: e.target.value })}
                        />
                      </Field>
                      <Field label="تاريخ النهاية (اختياري)">
                        <Input
                          type="date"
                          value={contractForm.endDate}
                          onChange={(e) => setContractForm({ ...contractForm, endDate: e.target.value })}
                        />
                      </Field>
                      <Field label="الراتب الأساسي">
                        <Input
                          type="number"
                          value={contractForm.basicSalary}
                          onChange={(e) => setContractForm({ ...contractForm, basicSalary: e.target.value })}
                        />
                      </Field>
                      <Field label="بدل سكن">
                        <Input
                          type="number"
                          value={contractForm.housingAllowance}
                          onChange={(e) => setContractForm({ ...contractForm, housingAllowance: e.target.value })}
                        />
                      </Field>
                      <Field label="بدل نقل">
                        <Input
                          type="number"
                          value={contractForm.transportAllowance}
                          onChange={(e) => setContractForm({ ...contractForm, transportAllowance: e.target.value })}
                        />
                      </Field>
                    </div>
                    <DialogFooter>
                      <Button
                        onClick={() => {
                          if (!contractForm.employeeId || !contractForm.basicSalary) {
                            toast({ title: "بيانات ناقصة", variant: "destructive" });
                            return;
                          }
                          createContract.mutate({
                            employeeId: Number(contractForm.employeeId),
                            contractType: contractForm.contractType,
                            startDate: contractForm.startDate,
                            endDate: contractForm.endDate || null,
                            basicSalary: Number(contractForm.basicSalary),
                            housingAllowance: Number(contractForm.housingAllowance || 0),
                            transportAllowance: Number(contractForm.transportAllowance || 0),
                            otherAllowances: 0,
                            gosiApplies: contractForm.gosiApplies,
                          });
                        }}
                        disabled={createContract.isPending}
                      >
                        حفظ العقد
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                العقود تنشأ من زر "عقد جديد" أعلاه. يمكن مراجعتها في صفحة الموظف.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----- Leaves ----- */}
        <TabsContent value="leaves">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>طلبات الإجازات</CardTitle>
              {canWrite && (
                <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plane className="ml-2 h-4 w-4" /> طلب جديد
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>طلب إجازة</DialogTitle>
                    </DialogHeader>
                    <div className="grid grid-cols-2 gap-4 py-2">
                      <Field label="الموظف" className="col-span-2">
                        <Select
                          value={leaveForm.employeeId}
                          onValueChange={(v) => setLeaveForm({ ...leaveForm, employeeId: v })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="اختر..." />
                          </SelectTrigger>
                          <SelectContent>
                            {(employeesQ.data ?? []).map((e) => (
                              <SelectItem key={e.id} value={String(e.id)}>
                                {e.nameAr}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="نوع الإجازة" className="col-span-2">
                        <Select
                          value={leaveForm.leaveTypeId}
                          onValueChange={(v) => setLeaveForm({ ...leaveForm, leaveTypeId: v })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="اختر..." />
                          </SelectTrigger>
                          <SelectContent>
                            {(leaveTypesQ.data ?? []).map((lt) => (
                              <SelectItem key={lt.id} value={String(lt.id)}>
                                {lt.nameAr}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="من تاريخ">
                        <Input
                          type="date"
                          value={leaveForm.startDate}
                          onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })}
                        />
                      </Field>
                      <Field label="إلى تاريخ">
                        <Input
                          type="date"
                          value={leaveForm.endDate}
                          onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
                        />
                      </Field>
                      <Field label="السبب" className="col-span-2">
                        <Input
                          value={leaveForm.reason}
                          onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                        />
                      </Field>
                    </div>
                    <DialogFooter>
                      <Button
                        onClick={() => {
                          if (!leaveForm.employeeId || !leaveForm.leaveTypeId) {
                            toast({ title: "بيانات ناقصة", variant: "destructive" });
                            return;
                          }
                          createLeave.mutate({
                            employeeId: Number(leaveForm.employeeId),
                            leaveTypeId: Number(leaveForm.leaveTypeId),
                            startDate: leaveForm.startDate,
                            endDate: leaveForm.endDate,
                            reason: leaveForm.reason || null,
                          });
                        }}
                        disabled={createLeave.isPending}
                      >
                        إرسال الطلب
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الرقم</TableHead>
                    <TableHead>الموظف</TableHead>
                    <TableHead>النوع</TableHead>
                    <TableHead>من</TableHead>
                    <TableHead>إلى</TableHead>
                    <TableHead>الأيام</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>الإجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(leaveReqsQ.data ?? []).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.reference}</TableCell>
                      <TableCell>{r.employeeName}</TableCell>
                      <TableCell>{r.leaveTypeName}</TableCell>
                      <TableCell>{r.startDate}</TableCell>
                      <TableCell>{r.endDate}</TableCell>
                      <TableCell>{r.days}</TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell>
                        {canWrite && r.status === "pending" && (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => decideLeave.mutate({ id: r.id, action: "approve" })}
                            >
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => decideLeave.mutate({ id: r.id, action: "reject" })}
                            >
                              <XCircle className="h-4 w-4 text-rose-600" />
                            </Button>
                          </div>
                        )}
                        {r.status === "pending_approval" && (
                          <ApprovalActions docType="leave_request" recordId={r.id} compact />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----- Expense Claims ----- */}
        <TabsContent value="expenses">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>مطالبات المصروفات</CardTitle>
              {canWrite && (
                <Dialog open={expenseOpen} onOpenChange={setExpenseOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Wallet className="ml-2 h-4 w-4" /> مطالبة جديدة
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>مطالبة مصروف</DialogTitle>
                    </DialogHeader>
                    <div className="grid grid-cols-2 gap-4 py-2">
                      <Field label="الموظف" className="col-span-2">
                        <Select
                          value={expenseForm.employeeId}
                          onValueChange={(v) => setExpenseForm({ ...expenseForm, employeeId: v })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="اختر..." />
                          </SelectTrigger>
                          <SelectContent>
                            {(employeesQ.data ?? []).map((e) => (
                              <SelectItem key={e.id} value={String(e.id)}>
                                {e.nameAr}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="التاريخ">
                        <Input
                          type="date"
                          value={expenseForm.claimDate}
                          onChange={(e) => setExpenseForm({ ...expenseForm, claimDate: e.target.value })}
                        />
                      </Field>
                      <Field label="العملة">
                        <Input
                          value={expenseForm.currency}
                          onChange={(e) => setExpenseForm({ ...expenseForm, currency: e.target.value })}
                        />
                      </Field>
                      <Field label="المبلغ">
                        <Input
                          type="number"
                          step="0.01"
                          value={expenseForm.amount}
                          onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                        />
                      </Field>
                      <Field label="التصنيف">
                        <Input
                          value={expenseForm.category}
                          onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}
                        />
                      </Field>
                      <Field label="رابط الإيصال" className="col-span-2">
                        <Input
                          value={expenseForm.receiptUrl}
                          onChange={(e) => setExpenseForm({ ...expenseForm, receiptUrl: e.target.value })}
                        />
                      </Field>
                      <Field label="الوصف" className="col-span-2">
                        <Input
                          value={expenseForm.description}
                          onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })}
                        />
                      </Field>
                    </div>
                    <DialogFooter>
                      <Button
                        onClick={() => {
                          if (!expenseForm.employeeId || !expenseForm.amount) {
                            toast({ title: "بيانات ناقصة", variant: "destructive" });
                            return;
                          }
                          createExpenseClaim.mutate({
                            employeeId: Number(expenseForm.employeeId),
                            claimDate: expenseForm.claimDate,
                            currency: expenseForm.currency || "SAR",
                            amount: Number(expenseForm.amount),
                            category: expenseForm.category || null,
                            description: expenseForm.description || null,
                            receiptUrl: expenseForm.receiptUrl || null,
                          });
                        }}
                        disabled={createExpenseClaim.isPending}
                      >
                        إرسال المطالبة
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الرقم</TableHead>
                    <TableHead>الموظف</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>التصنيف</TableHead>
                    <TableHead>المبلغ</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>الإجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(expenseClaimsQ.data ?? []).map((c) => {
                    const emp = (employeesQ.data ?? []).find((e) => e.id === c.employeeId);
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs">{c.reference}</TableCell>
                        <TableCell>{emp?.nameAr ?? `#${c.employeeId}`}</TableCell>
                        <TableCell>{c.claimDate}</TableCell>
                        <TableCell>{c.category ?? "—"}</TableCell>
                        <TableCell>{fmtMoney(Number(c.amount))}</TableCell>
                        <TableCell>
                          <StatusBadge status={c.status} />
                        </TableCell>
                        <TableCell>
                          {(c.status === "pending_approval" || c.status === "pending") && (
                            <ApprovalActions docType="expense_claim" recordId={c.id} compact />
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----- Payroll ----- */}
        <TabsContent value="payroll" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>فترات الرواتب</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {canWrite && (
                <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
                  <div className="space-y-1">
                    <Label>السنة</Label>
                    <Input
                      type="number"
                      className="w-24"
                      value={newPeriod.year}
                      onChange={(e) => setNewPeriod({ ...newPeriod, year: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>الشهر</Label>
                    <Input
                      type="number"
                      min={1}
                      max={12}
                      className="w-24"
                      value={newPeriod.month}
                      onChange={(e) => setNewPeriod({ ...newPeriod, month: Number(e.target.value) })}
                    />
                  </div>
                  <Button onClick={() => createPeriod.mutate(newPeriod)} disabled={createPeriod.isPending}>
                    إنشاء فترة
                  </Button>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الفترة</TableHead>
                    <TableHead>من</TableHead>
                    <TableHead>إلى</TableHead>
                    <TableHead>تاريخ الصرف</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>الإجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(periodsQ.data ?? []).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>{p.startDate}</TableCell>
                      <TableCell>{p.endDate}</TableCell>
                      <TableCell>{p.payDate}</TableCell>
                      <TableCell>
                        <StatusBadge status={p.status} />
                      </TableCell>
                      <TableCell>
                        {canWrite && (
                          <Button size="sm" onClick={() => computeRun.mutate(p.id)} disabled={computeRun.isPending}>
                            <Calculator className="ml-2 h-4 w-4" /> احتساب
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>جولات الرواتب</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المرجع</TableHead>
                    <TableHead>الفترة</TableHead>
                    <TableHead>عدد الموظفين</TableHead>
                    <TableHead>إجمالي</TableHead>
                    <TableHead>تأمينات (موظف)</TableHead>
                    <TableHead>تأمينات (شركة)</TableHead>
                    <TableHead>صافي</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>الإجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(runsQ.data ?? []).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.reference}</TableCell>
                      <TableCell>{r.periodName}</TableCell>
                      <TableCell>{r.employeeCount}</TableCell>
                      <TableCell>{fmtMoney(r.totalGross)}</TableCell>
                      <TableCell>{fmtMoney(r.totalGosiEmployee)}</TableCell>
                      <TableCell>{fmtMoney(r.totalGosiEmployer)}</TableCell>
                      <TableCell className="font-bold">{fmtMoney(r.totalNet)}</TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => window.open(`${API_BASE}/hr/payroll-runs/${r.id}/wps`, "_blank")}
                          >
                            <Download className="ml-1 h-4 w-4" /> WPS
                          </Button>
                          {canPayroll && r.status === "computed" && (
                            <Button size="sm" onClick={() => postRun.mutate(r.id)} disabled={postRun.isPending}>
                              ترحيل
                            </Button>
                          )}
                          {canPayroll && r.status === "posted" && (
                            <Button size="sm" variant="outline" onClick={() => markPaid.mutate(r.id)}>
                              تم الدفع
                            </Button>
                          )}
                          {canPayroll &&
                            (r.status === "posted" || r.status === "paid") &&
                            !r.gosiRemittedAt &&
                            (r.totalGosiEmployee + r.totalGosiEmployer) > 0 && (
                              <Button size="sm" variant="outline" onClick={() => remitGosi.mutate(r.id)}>
                                تحويل التأمينات
                              </Button>
                            )}
                          {r.gosiRemittedAt && (
                            <span className="text-xs text-muted-foreground self-center">تأمينات محوّلة</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {runsQ.data?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground">
                        لا توجد جولات رواتب بعد
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----- Org Chart ----- */}
        <TabsContent value="orgchart">
          <Card>
            <CardHeader>
              <CardTitle>الهيكل التنظيمي للإدارات</CardTitle>
            </CardHeader>
            <CardContent>
              {(orgQ.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">لا توجد إدارات بعد</p>
              ) : (
                <div className="space-y-2">
                  {(orgQ.data ?? []).map((n) => (
                    <OrgNodeView key={n.id} node={n} depth={0} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----- Attendance ----- */}
        <TabsContent value="attendance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>ملخص الحضور والانصراف</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <Field label="من تاريخ">
                  <Input
                    type="date"
                    value={attRange.from}
                    onChange={(e) => setAttRange({ ...attRange, from: e.target.value })}
                  />
                </Field>
                <Field label="إلى تاريخ">
                  <Input
                    type="date"
                    value={attRange.to}
                    onChange={(e) => setAttRange({ ...attRange, to: e.target.value })}
                  />
                </Field>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم الموظف</TableHead>
                    <TableHead>الموظف</TableHead>
                    <TableHead>الوردية</TableHead>
                    <TableHead>أيام العمل</TableHead>
                    <TableHead>حاضر</TableHead>
                    <TableHead>غائب</TableHead>
                    <TableHead>تأخير (دقيقة)</TableHead>
                    <TableHead>انصراف مبكر (دقيقة)</TableHead>
                    <TableHead>ساعات إضافية</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(attendanceQ.data ?? []).map((r) => (
                    <TableRow key={r.employeeId}>
                      <TableCell className="font-mono text-xs">{r.employeeNo}</TableCell>
                      <TableCell>{r.employeeName}</TableCell>
                      <TableCell>{r.shiftName}</TableCell>
                      <TableCell>{r.workingDays}</TableCell>
                      <TableCell>{r.presentDays}</TableCell>
                      <TableCell>
                        {r.absentDays > 0 ? (
                          <Badge variant="destructive">{r.absentDays}</Badge>
                        ) : (
                          <span>0</span>
                        )}
                      </TableCell>
                      <TableCell>{r.lateMinutes}</TableCell>
                      <TableCell>{r.earlyLeaveMinutes}</TableCell>
                      <TableCell>{r.overtimeHours.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                  {attendanceQ.data?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground">
                        لا توجد بيانات حضور في هذه الفترة
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----- Shifts & Salary Components ----- */}
        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>الورديات</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                <Field label="الاسم">
                  <Input value={newShift.name} onChange={(e) => setNewShift({ ...newShift, name: e.target.value })} />
                </Field>
                <Field label="الاسم بالعربي">
                  <Input value={newShift.nameAr} onChange={(e) => setNewShift({ ...newShift, nameAr: e.target.value })} />
                </Field>
                <Field label="بداية">
                  <Input type="time" value={newShift.startTime} onChange={(e) => setNewShift({ ...newShift, startTime: e.target.value })} />
                </Field>
                <Field label="نهاية">
                  <Input type="time" value={newShift.endTime} onChange={(e) => setNewShift({ ...newShift, endTime: e.target.value })} />
                </Field>
                <Field label="استراحة (دقائق)">
                  <Input type="number" value={newShift.breakMinutes} onChange={(e) => setNewShift({ ...newShift, breakMinutes: Number(e.target.value) })} />
                </Field>
                <Field label="أيام العمل (0=الأحد)">
                  <Input value={newShift.workingDays} onChange={(e) => setNewShift({ ...newShift, workingDays: e.target.value })} />
                </Field>
              </div>
              <Button
                onClick={() => createShiftMut.mutate()}
                disabled={createShiftMut.isPending || !newShift.name || !newShift.nameAr}
              >
                إضافة وردية
              </Button>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الاسم</TableHead>
                    <TableHead>الوقت</TableHead>
                    <TableHead>الاستراحة</TableHead>
                    <TableHead>أيام العمل</TableHead>
                    <TableHead>الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(shiftsQ.data ?? []).map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{s.nameAr}</TableCell>
                      <TableCell>{s.startTime} → {s.endTime}</TableCell>
                      <TableCell>{s.breakMinutes} د</TableCell>
                      <TableCell className="font-mono text-xs">{s.workingDays}</TableCell>
                      <TableCell>
                        <Badge variant={s.isActive ? "default" : "outline"}>
                          {s.isActive ? "نشطة" : "متوقفة"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>تعيين وردية لموظف</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Field label="الموظف">
                  <Select
                    value={String(assignShift.employeeId || "")}
                    onValueChange={(v) => setAssignShift({ ...assignShift, employeeId: Number(v) })}
                  >
                    <SelectTrigger><SelectValue placeholder="اختر الموظف" /></SelectTrigger>
                    <SelectContent>
                      {(employeesQ.data ?? []).map((e) => (
                        <SelectItem key={e.id} value={String(e.id)}>{e.nameAr}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="الوردية">
                  <Select
                    value={String(assignShift.shiftId || "")}
                    onValueChange={(v) => setAssignShift({ ...assignShift, shiftId: Number(v) })}
                  >
                    <SelectTrigger><SelectValue placeholder="اختر الوردية" /></SelectTrigger>
                    <SelectContent>
                      {(shiftsQ.data ?? []).map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>{s.nameAr}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="نافذة من">
                  <Input
                    type="date"
                    value={assignShift.effectiveFrom}
                    onChange={(e) => setAssignShift({ ...assignShift, effectiveFrom: e.target.value })}
                  />
                </Field>
                <div className="flex items-end">
                  <Button
                    onClick={() => assignShiftMut.mutate()}
                    disabled={!assignShift.employeeId || !assignShift.shiftId || assignShiftMut.isPending}
                  >
                    تعيين
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>عناصر الراتب الثابتة (بدلات / استقطاعات حسب العقد)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="العقد">
                <Select
                  value={String(selectedContractId || "")}
                  onValueChange={(v) => setSelectedContractId(Number(v))}
                >
                  <SelectTrigger><SelectValue placeholder="اختر العقد" /></SelectTrigger>
                  <SelectContent>
                    {(contractsQ.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.reference} — موظف #{c.employeeId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {selectedContractId > 0 && (
                <>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                    <Field label="الاسم"><Input value={newComp.name} onChange={(e) => setNewComp({ ...newComp, name: e.target.value })} /></Field>
                    <Field label="بالعربي"><Input value={newComp.nameAr} onChange={(e) => setNewComp({ ...newComp, nameAr: e.target.value })} /></Field>
                    <Field label="النوع">
                      <Select value={newComp.kind} onValueChange={(v) => setNewComp({ ...newComp, kind: v as "earning" | "deduction" })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="earning">بدل (إضافة)</SelectItem>
                          <SelectItem value="deduction">استقطاع</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="المبلغ">
                      <Input type="number" value={newComp.amount} onChange={(e) => setNewComp({ ...newComp, amount: Number(e.target.value) })} />
                    </Field>
                    <Field label="يحتسب في GOSI؟">
                      <Select value={newComp.includeInGosi ? "yes" : "no"} onValueChange={(v) => setNewComp({ ...newComp, includeInGosi: v === "yes" })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="no">لا</SelectItem>
                          <SelectItem value="yes">نعم</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <Button
                    onClick={() => createCompMut.mutate()}
                    disabled={!newComp.name || !newComp.nameAr || newComp.amount <= 0 || createCompMut.isPending}
                  >
                    إضافة عنصر
                  </Button>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الاسم</TableHead>
                        <TableHead>النوع</TableHead>
                        <TableHead>المبلغ</TableHead>
                        <TableHead>GOSI</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(componentsQ.data ?? []).map((c) => (
                        <TableRow key={c.id}>
                          <TableCell>{c.nameAr}</TableCell>
                          <TableCell>
                            <Badge variant={c.kind === "earning" ? "default" : "destructive"}>
                              {c.kind === "earning" ? "بدل" : "استقطاع"}
                            </Badge>
                          </TableCell>
                          <TableCell>{fmtMoney(c.amount)}</TableCell>
                          <TableCell>{c.includeInGosi ? "نعم" : "لا"}</TableCell>
                          <TableCell>
                            <Button size="sm" variant="ghost" onClick={() => deleteCompMut.mutate(c.id)}>
                              <XCircle className="h-4 w-4 text-red-600" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----- Payslips ----- */}
        <TabsContent value="payslips">
          <Card>
            <CardHeader>
              <CardTitle>بيانات الرواتب الصادرة</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المرجع</TableHead>
                    <TableHead>الموظف</TableHead>
                    <TableHead>الفترة</TableHead>
                    <TableHead>الجولة</TableHead>
                    <TableHead>صافي الراتب</TableHead>
                    <TableHead>تاريخ الإصدار</TableHead>
                    <TableHead>الإجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(payslipsQ.data ?? []).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.reference}</TableCell>
                      <TableCell>{p.employeeName}</TableCell>
                      <TableCell>{p.periodName}</TableCell>
                      <TableCell className="font-mono text-xs">{p.runReference}</TableCell>
                      <TableCell className="font-bold">{fmtMoney(p.netPay)}</TableCell>
                      <TableCell>{p.createdAt.slice(0, 10)}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(`${API_BASE}/hr/payslips/${p.id}/pdf`, "_blank")}
                        >
                          <Download className="ml-1 h-4 w-4" /> عرض / طباعة
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {payslipsQ.data?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        لا توجد بيانات رواتب صادرة بعد
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----- Alerts ----- */}
        <TabsContent value="alerts">
          <Card>
            <CardHeader>
              <CardTitle>تنبيهات انتهاء الوثائق (90 يوم القادمة)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>النوع</TableHead>
                    <TableHead>الموظف</TableHead>
                    <TableHead>المرجع</TableHead>
                    <TableHead>تاريخ الانتهاء</TableHead>
                    <TableHead>الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(expiryQ.data ?? []).map((a, idx) => (
                    <TableRow key={`${a.kind}-${a.id}-${idx}`}>
                      <TableCell>
                        <Badge variant="outline">
                          {a.kind === "iqama" ? "إقامة" : a.kind === "passport" ? "جواز سفر" : "عقد"}
                        </Badge>
                      </TableCell>
                      <TableCell>{a.name}</TableCell>
                      <TableCell className="font-mono text-xs">{a.reference ?? a.employeeNo}</TableCell>
                      <TableCell>{a.expiryDate}</TableCell>
                      <TableCell>
                        {a.isOverdue ? (
                          <Badge variant="destructive">منتهي</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
                            قريب الانتهاء
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {expiryQ.data?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        لا توجد وثائق قاربت على الانتهاء
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----- Reports ----- */}
        <TabsContent value="reports" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>السعودة (نطاقات)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الفرع</TableHead>
                    <TableHead>إجمالي</TableHead>
                    <TableHead>سعوديون</TableHead>
                    <TableHead>غير سعوديين</TableHead>
                    <TableHead>نسبة السعودة</TableHead>
                    <TableHead>النطاق</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(saudiQ.data ?? []).map((r, idx) => (
                    <TableRow key={`${r.branchId}-${idx}`}>
                      <TableCell>{r.branchName ?? "بدون فرع"}</TableCell>
                      <TableCell>{r.total}</TableCell>
                      <TableCell>{r.saudis}</TableCell>
                      <TableCell>{r.nonSaudis}</TableCell>
                      <TableCell>{r.saudizationRatio}%</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={NITAQAT_COLOR[r.nitaqatBand]}>
                          {r.nitaqatBand === "platinum"
                            ? "بلاتيني"
                            : r.nitaqatBand === "green"
                            ? "أخضر"
                            : r.nitaqatBand === "yellow"
                            ? "أصفر"
                            : "أحمر"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {saudiQ.data?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        لا توجد بيانات
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>إعدادات GOSI الحالية</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                النسب المعتمدة حالياً: 9.75% الموظف، 11.75% الشركة، 2% للموظف غير السعودي (إصابات عمل)، سقف الراتب
                المؤمن عليه 45,000 ر.س. تُستخدم تلقائياً عند احتساب الرواتب.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>كشف الرواتب الكامل (Payroll Register)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-end gap-3">
                <Field label="جولة الرواتب">
                  <Select value={registerRunId} onValueChange={setRegisterRunId}>
                    <SelectTrigger className="w-[280px]"><SelectValue placeholder="اختر الجولة..." /></SelectTrigger>
                    <SelectContent>
                      {(runsQ.data ?? []).map((r) => (
                        <SelectItem key={r.id} value={String(r.id)}>{r.reference}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              {registerQ.data && (
                <>
                  <div className="text-sm text-muted-foreground">
                    {registerQ.data.employees} موظف — صافي الإجمالي: {registerQ.data.totals.netPay?.toLocaleString("ar-SA", { minimumFractionDigits: 2 })} ر.س
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الرقم</TableHead>
                        <TableHead>الموظف</TableHead>
                        <TableHead>الإجمالي</TableHead>
                        <TableHead>التأمينات (موظف)</TableHead>
                        <TableHead>إجمالي الخصومات</TableHead>
                        <TableHead>الصافي</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {registerQ.data.detail.map((r) => (
                        <TableRow key={r.employeeNo}>
                          <TableCell className="font-mono text-xs">{r.employeeNo}</TableCell>
                          <TableCell>{r.employeeName}</TableCell>
                          <TableCell>{r.grossPay.toLocaleString("ar-SA", { minimumFractionDigits: 2 })}</TableCell>
                          <TableCell>{r.gosiEmployee.toLocaleString("ar-SA", { minimumFractionDigits: 2 })}</TableCell>
                          <TableCell>{r.totalDeductions.toLocaleString("ar-SA", { minimumFractionDigits: 2 })}</TableCell>
                          <TableCell className="font-bold">{r.netPay.toLocaleString("ar-SA", { minimumFractionDigits: 2 })}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>تقرير GOSI لكل جولة</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="جولة الرواتب">
                <Select value={gosiRunId} onValueChange={setGosiRunId}>
                  <SelectTrigger className="w-[280px]"><SelectValue placeholder="اختر الجولة..." /></SelectTrigger>
                  <SelectContent>
                    {(runsQ.data ?? []).map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>{r.reference}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {gosiReportQ.data && (
                <>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <KpiCard title="قاعدة GOSI" value={gosiReportQ.data.totals.gosiBase.toLocaleString("ar-SA")} icon={<Wallet className="h-5 w-5" />} color="teal" />
                    <KpiCard title="حصة الموظف" value={gosiReportQ.data.totals.gosiEmployee.toLocaleString("ar-SA")} icon={<Wallet className="h-5 w-5" />} color="emerald" />
                    <KpiCard title="حصة الشركة" value={gosiReportQ.data.totals.gosiEmployer.toLocaleString("ar-SA")} icon={<Wallet className="h-5 w-5" />} color="amber" />
                    <KpiCard title="إجمالي السداد" value={gosiReportQ.data.totals.total.toLocaleString("ar-SA")} icon={<Wallet className="h-5 w-5" />} color="rose" />
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الموظف</TableHead>
                        <TableHead>الجنسية</TableHead>
                        <TableHead>القاعدة</TableHead>
                        <TableHead>حصة الموظف</TableHead>
                        <TableHead>حصة الشركة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {gosiReportQ.data.employees.map((r) => (
                        <TableRow key={r.employeeNo}>
                          <TableCell>{r.employeeName} <span className="text-xs text-muted-foreground">({r.employeeNo})</span></TableCell>
                          <TableCell><Badge variant="outline">{r.nationalityType === "saudi" ? "سعودي" : "غير سعودي"}</Badge></TableCell>
                          <TableCell>{r.gosiBase.toLocaleString("ar-SA", { minimumFractionDigits: 2 })}</TableCell>
                          <TableCell>{r.gosiEmployee.toLocaleString("ar-SA", { minimumFractionDigits: 2 })}</TableCell>
                          <TableCell>{r.gosiEmployer.toLocaleString("ar-SA", { minimumFractionDigits: 2 })}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----- Operations: leave calendar/balances, loans, documents, GOSI settings, EOS, punch entry ----- */}
        <TabsContent value="ops" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>تقويم الإجازات</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <Field label="من"><Input type="date" value={calRange.from} onChange={(e) => setCalRange({ ...calRange, from: e.target.value })} /></Field>
                <Field label="إلى"><Input type="date" value={calRange.to} onChange={(e) => setCalRange({ ...calRange, to: e.target.value })} /></Field>
              </div>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>المرجع</TableHead><TableHead>الموظف</TableHead><TableHead>النوع</TableHead>
                  <TableHead>من</TableHead><TableHead>إلى</TableHead><TableHead>أيام</TableHead><TableHead>الحالة</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {(calendarQ.data ?? []).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.reference}</TableCell>
                      <TableCell>{r.employeeName}</TableCell>
                      <TableCell>{r.leaveTypeName}</TableCell>
                      <TableCell>{r.startDate}</TableCell>
                      <TableCell>{r.endDate}</TableCell>
                      <TableCell>{r.days}</TableCell>
                      <TableCell><StatusBadge status={r.status} /></TableCell>
                    </TableRow>
                  ))}
                  {calendarQ.data?.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">لا توجد إجازات في الفترة</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>أرصدة الإجازات</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Field label="موظف (اختياري)">
                <Select value={opsEmployeeId || "all"} onValueChange={(v) => setOpsEmployeeId(v === "all" ? "" : v)}>
                  <SelectTrigger className="w-[280px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">جميع الموظفين</SelectItem>
                    {(employeesQ.data ?? []).map((e) => (
                      <SelectItem key={e.id} value={String(e.id)}>{e.nameAr}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>السنة</TableHead><TableHead>النوع</TableHead>
                  <TableHead>المستحق</TableHead><TableHead>المستهلك</TableHead>
                  <TableHead>قيد الموافقة</TableHead><TableHead>المتبقي</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {(balancesQ.data ?? []).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.year}</TableCell>
                      <TableCell>{r.leaveTypeName}</TableCell>
                      <TableCell>{r.entitlement}</TableCell>
                      <TableCell>{r.used}</TableCell>
                      <TableCell>{r.pending}</TableCell>
                      <TableCell className="font-bold">{r.remaining}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>القروض والسلف</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {canWrite && (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  <Field label="الموظف">
                    <Select value={loanForm.employeeId} onValueChange={(v) => setLoanForm({ ...loanForm, employeeId: v })}>
                      <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
                      <SelectContent>
                        {(employeesQ.data ?? []).map((e) => (
                          <SelectItem key={e.id} value={String(e.id)}>{e.nameAr}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="المبلغ"><Input type="number" value={loanForm.principal} onChange={(e) => setLoanForm({ ...loanForm, principal: e.target.value })} /></Field>
                  <Field label="القسط الشهري"><Input type="number" value={loanForm.monthlyInstallment} onChange={(e) => setLoanForm({ ...loanForm, monthlyInstallment: e.target.value })} /></Field>
                  <Field label="تاريخ البداية"><Input type="date" value={loanForm.startDate} onChange={(e) => setLoanForm({ ...loanForm, startDate: e.target.value })} /></Field>
                  <Field label="السبب"><Input value={loanForm.reason} onChange={(e) => setLoanForm({ ...loanForm, reason: e.target.value })} /></Field>
                  <div className="flex items-end"><Button onClick={() => createLoan.mutate()} disabled={!loanForm.employeeId || !loanForm.principal || !loanForm.monthlyInstallment || createLoan.isPending}>إضافة قرض</Button></div>
                </div>
              )}
              <Table>
                <TableHeader><TableRow>
                  <TableHead>الموظف</TableHead><TableHead>المبلغ</TableHead><TableHead>المتبقي</TableHead>
                  <TableHead>القسط</TableHead><TableHead>البدء</TableHead><TableHead>الحالة</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {(loansQ.data ?? []).map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>{l.employeeName ?? l.employeeId}</TableCell>
                      <TableCell>{Number(l.principal).toLocaleString("ar-SA", { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell>{Number(l.remaining).toLocaleString("ar-SA", { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell>{Number(l.monthlyInstallment).toLocaleString("ar-SA", { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell>{l.startDate}</TableCell>
                      <TableCell><StatusBadge status={l.status} /></TableCell>
                    </TableRow>
                  ))}
                  {loansQ.data?.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">لا توجد قروض</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>وثائق الموظفين</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Field label="الموظف">
                <Select value={docEmpId} onValueChange={setDocEmpId}>
                  <SelectTrigger className="w-[280px]"><SelectValue placeholder="اختر موظفاً..." /></SelectTrigger>
                  <SelectContent>
                    {(employeesQ.data ?? []).map((e) => (
                      <SelectItem key={e.id} value={String(e.id)}>{e.nameAr}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {docEmpId && (
                <>
                  {canWrite && (
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                      <Field label="النوع">
                        <Select value={docForm.docType} onValueChange={(v) => setDocForm({ ...docForm, docType: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="iqama">إقامة</SelectItem>
                            <SelectItem value="passport">جواز سفر</SelectItem>
                            <SelectItem value="national_id">هوية وطنية</SelectItem>
                            <SelectItem value="contract">عقد</SelectItem>
                            <SelectItem value="health_insurance">تأمين صحي</SelectItem>
                            <SelectItem value="other">أخرى</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="رقم المرجع"><Input value={docForm.reference} onChange={(e) => setDocForm({ ...docForm, reference: e.target.value })} /></Field>
                      <Field label="رابط الملف"><Input value={docForm.fileUrl} onChange={(e) => setDocForm({ ...docForm, fileUrl: e.target.value })} placeholder="https://..." /></Field>
                      <Field label="ينتهي في"><Input type="date" value={docForm.expiresOn} onChange={(e) => setDocForm({ ...docForm, expiresOn: e.target.value })} /></Field>
                      <div className="flex items-end"><Button onClick={() => createDoc.mutate()} disabled={createDoc.isPending}>حفظ الوثيقة</Button></div>
                    </div>
                  )}
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>النوع</TableHead><TableHead>المرجع</TableHead>
                      <TableHead>ينتهي في</TableHead><TableHead>الملف</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {(docsQ.data ?? []).map((d) => (
                        <TableRow key={d.id}>
                          <TableCell>{d.docType}</TableCell>
                          <TableCell className="font-mono text-xs">{d.reference ?? "—"}</TableCell>
                          <TableCell>{d.expiresOn ?? "—"}</TableCell>
                          <TableCell>{d.fileUrl ? <a href={d.fileUrl} target="_blank" rel="noreferrer" className="text-teal-600 underline">عرض</a> : "—"}</TableCell>
                        </TableRow>
                      ))}
                      {docsQ.data?.length === 0 && (
                        <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">لا توجد وثائق</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>إعدادات GOSI القابلة للتعديل</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {canPayroll && (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  <Field label="ساري من"><Input type="date" value={gosiForm.effectiveFrom} onChange={(e) => setGosiForm({ ...gosiForm, effectiveFrom: e.target.value })} /></Field>
                  <Field label="حصة الموظف %"><Input type="number" step="0.01" value={gosiForm.saudiEmployeeRate} onChange={(e) => setGosiForm({ ...gosiForm, saudiEmployeeRate: e.target.value })} /></Field>
                  <Field label="حصة الشركة %"><Input type="number" step="0.01" value={gosiForm.saudiEmployerRate} onChange={(e) => setGosiForm({ ...gosiForm, saudiEmployerRate: e.target.value })} /></Field>
                  <Field label="غير سعودي %"><Input type="number" step="0.01" value={gosiForm.nonSaudiEmployerRate} onChange={(e) => setGosiForm({ ...gosiForm, nonSaudiEmployerRate: e.target.value })} /></Field>
                  <Field label="سقف الراتب"><Input type="number" value={gosiForm.salaryCeiling} onChange={(e) => setGosiForm({ ...gosiForm, salaryCeiling: e.target.value })} /></Field>
                  <div className="flex items-end col-span-5"><Button onClick={() => createGosi.mutate()} disabled={createGosi.isPending}>إضافة إعداد جديد</Button></div>
                </div>
              )}
              <Table>
                <TableHeader><TableRow>
                  <TableHead>ساري من</TableHead><TableHead>الموظف %</TableHead>
                  <TableHead>الشركة %</TableHead><TableHead>غير سعودي %</TableHead><TableHead>السقف</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {(gosiQ.data ?? []).map((g) => (
                    <TableRow key={g.id}>
                      <TableCell>{g.effectiveFrom}</TableCell>
                      <TableCell>{g.saudiEmployeeRate}</TableCell>
                      <TableCell>{g.saudiEmployerRate}</TableCell>
                      <TableCell>{g.nonSaudiEmployerRate}</TableCell>
                      <TableCell>{Number(g.salaryCeiling).toLocaleString("ar-SA")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>حاسبة مكافأة نهاية الخدمة (EOS)</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Field label="الموظف">
                  <Select value={eosForm.employeeId} onValueChange={(v) => setEosForm({ ...eosForm, employeeId: v })}>
                    <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
                    <SelectContent>
                      {(employeesQ.data ?? []).map((e) => (
                        <SelectItem key={e.id} value={String(e.id)}>{e.nameAr}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="السبب">
                  <Select value={eosForm.reason} onValueChange={(v) => setEosForm({ ...eosForm, reason: v as "termination" | "resignation" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="termination">إنهاء من قبل الشركة</SelectItem>
                      <SelectItem value="resignation">استقالة</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="حتى تاريخ"><Input type="date" value={eosForm.asOf} onChange={(e) => setEosForm({ ...eosForm, asOf: e.target.value })} /></Field>
                <div className="flex items-end"><Button onClick={() => eosCalc.mutate()} disabled={!eosForm.employeeId || eosCalc.isPending}>احتساب</Button></div>
              </div>
              {eosResult && (
                <div className="rounded-md border p-3 text-sm space-y-1">
                  <div><b>الموظف:</b> {eosResult.employee.nameAr} ({eosResult.employee.employeeNo})</div>
                  <div><b>تاريخ التعيين:</b> {eosResult.employee.hireDate}</div>
                  <div><b>سنوات الخدمة:</b> {eosResult.yearsOfService}</div>
                  <div><b>الراتب الأساسي الشهري:</b> {eosResult.monthlyBasic.toLocaleString("ar-SA", { minimumFractionDigits: 2 })} ر.س</div>
                  <div><b>المكافأة الكاملة:</b> {eosResult.gratuityFull.toLocaleString("ar-SA", { minimumFractionDigits: 2 })} ر.س</div>
                  <div><b>معامل التخفيض:</b> {(eosResult.reductionFactor * 100).toFixed(1)}%</div>
                  <div className="text-base font-bold text-teal-600">المستحق: {eosResult.payable.toLocaleString("ar-SA", { minimumFractionDigits: 2 })} ر.س</div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>تسجيل حضور يدوي (Punch)</CardTitle></CardHeader>
            <CardContent>
              {canWrite ? (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Field label="الموظف">
                    <Select value={punchForm.employeeId} onValueChange={(v) => setPunchForm({ ...punchForm, employeeId: v })}>
                      <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
                      <SelectContent>
                        {(employeesQ.data ?? []).map((e) => (
                          <SelectItem key={e.id} value={String(e.id)}>{e.nameAr}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="التاريخ والوقت"><Input type="datetime-local" value={punchForm.punchAt} onChange={(e) => setPunchForm({ ...punchForm, punchAt: e.target.value })} /></Field>
                  <Field label="النوع">
                    <Select value={punchForm.kind} onValueChange={(v) => setPunchForm({ ...punchForm, kind: v as "in" | "out" })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="in">حضور</SelectItem>
                        <SelectItem value="out">انصراف</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <div className="flex items-end"><Button onClick={() => createPunch.mutate()} disabled={!punchForm.employeeId || createPunch.isPending}>تسجيل</Button></div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">صلاحيات الكتابة في الموارد البشرية مطلوبة.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function KpiCard({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  color: "teal" | "emerald" | "amber" | "rose";
}) {
  const colorMap = {
    teal: "from-teal-500/15 to-emerald-500/15 text-teal-600",
    emerald: "from-emerald-500/15 to-green-500/15 text-emerald-600",
    amber: "from-amber-500/15 to-orange-500/15 text-amber-600",
    rose: "from-rose-500/15 to-red-500/15 text-rose-600",
  } as const;
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${colorMap[color]}`}>
          {icon}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

type OrgChartNode = {
  id: number; name: string; parentId: number | null;
  managerEmployeeId: number | null; managerName: string | null;
  headcount: number; children: OrgChartNode[];
};
function OrgNodeView({ node, depth }: { node: OrgChartNode; depth: number }) {
  return (
    <div style={{ paddingInlineStart: depth * 24 }}>
      <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2">
        <UserCog className="h-4 w-4 text-teal-600" />
        <span className="font-medium">{node.name}</span>
        <Badge variant="outline">{node.headcount} موظف</Badge>
        {node.managerName && (
          <span className="text-xs text-muted-foreground">المدير: {node.managerName}</span>
        )}
      </div>
      {node.children.length > 0 && (
        <div className="mt-2 space-y-2">
          {node.children.map((c) => (
            <OrgNodeView key={c.id} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// Suppress unused-warning for icons reserved for future tabs.
void Clock;
void Wallet;
