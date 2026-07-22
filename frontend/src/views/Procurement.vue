<template>
  <div class="page">
    <div class="glass" style="padding:18px;">
      <div class="toolbar mb-12">
        <h3 class="panel-title" style="margin:0;"><span class="bar"></span>采购计划</h3>
        <div class="grow"></div>
        <el-button type="primary" :icon="Plus" @click="openCreate">新建采购计划</el-button>
      </div>
      <el-table :data="rows" stripe>
        <el-table-column prop="planNo" label="计划单号" width="170" />
        <el-table-column label="月份" prop="month" width="100" />
        <el-table-column label="申请院系" width="200">
          <template #default="{ row }">{{ deptName(row.departmentId) }}</template>
        </el-table-column>
        <el-table-column label="申请人">
          <template #default="{ row }">{{ row.applicant?.fullName }}</template>
        </el-table-column>
        <el-table-column label="品项数" width="100">
          <template #default="{ row }">{{ row.items.length }}</template>
        </el-table-column>
        <el-table-column label="总金额" width="140">
          <template #default="{ row }">¥ {{ row.totalAmount.toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button size="small" link @click="openDetail(row)">查看</el-button>
            <el-button v-if="canApprove(row)" size="small" type="primary" link @click="approve(row)">审批</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 新建对话框 -->
    <el-dialog v-model="createVisible" title="新建采购计划" width="780px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="月份">
          <el-date-picker v-model="form.month" type="month" value-format="YYYY-MM" placeholder="选择月份" />
        </el-form-item>
        <el-form-item label="申请院系">
          <el-tree-select v-model="form.departmentId" :data="deptTree" check-strictly :props="{ value: 'id', label: 'name' }" placeholder="选择院系" style="width:100%;" />
        </el-form-item>
        <el-form-item label="品项明细">
          <el-button size="small" @click="addItem">添加品项</el-button>
        </el-form-item>
        <el-table :data="form.items" border>
          <el-table-column label="化学品">
            <template #default="{ row }">
              <el-select v-model="row.chemicalId" filterable style="width:100%;" @change="(v:any)=>onChemChange(row, v)">
                <el-option v-for="c in chemicals" :key="c.id" :value="c.id" :label="`${c.name} (${c.casNo})`" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="申购量" width="120">
            <template #default="{ row }"><el-input-number v-model="row.requestedQty" :min="0" size="small" style="width:100px;" /></template>
          </el-table-column>
          <el-table-column label="建议量" width="100">
            <template #default="{ row }">{{ row.suggestedQty }}</template>
          </el-table-column>
          <el-table-column label="单价" width="120">
            <template #default="{ row }"><el-input-number v-model="row.estPrice" :min="0" :precision="2" size="small" style="width:100px;" /></template>
          </el-table-column>
          <el-table-column label="操作" width="80">
            <template #default="{ $index }"><el-button size="small" type="danger" link @click="form.items.splice($index,1)">删除</el-button></template>
          </el-table-column>
        </el-table>
        <el-form-item label="备注" class="mt-12">
          <el-input v-model="form.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">提交审批</el-button>
      </template>
    </el-dialog>

    <!-- 详情 / 审批 -->
    <el-drawer v-model="detailVisible" :title="current?.planNo" size="560px">
      <div v-if="current">
        <div class="kpi-grid" style="grid-template-columns:1fr 1fr;">
          <div class="kpi"><div class="label">月份</div><div class="value">{{ current.month }}</div></div>
          <div class="kpi"><div class="label">总金额</div><div class="value">¥ {{ current.totalAmount.toFixed(2) }}</div></div>
        </div>
        <h4 class="panel-title"><span class="bar"></span>审批流</h4>
        <el-steps :active="approvalStepIndex" finish-status="success" direction="vertical">
          <el-step v-for="a in current.approvals" :key="a.id" :title="a.stepName" :description="a.comment || (a.status === 'PENDING' ? '待审批' : (a.approver?.fullName || ''))" :status="a.status === 'REJECTED' ? 'error' : (a.status === 'APPROVED' ? 'success' : 'process')" />
        </el-steps>
        <h4 class="panel-title mt-12"><span class="bar"></span>品项明细</h4>
        <el-table :data="current.items" size="small">
          <el-table-column label="化学品"><template #default="{ row }">{{ row.chemical.name }}</template></el-table-column>
          <el-table-column label="CAS" prop="chemical.casNo" />
          <el-table-column label="申购" prop="requestedQty" width="80" />
          <el-table-column label="建议" prop="suggestedQty" width="80" />
          <el-table-column label="单价" width="100"><template #default="{ row }">¥ {{ row.estPrice.toFixed(2) }}</template></el-table-column>
        </el-table>
        <div v-if="nextApproval" class="mt-12">
          <el-input v-model="comment" placeholder="审批意见" />
          <div class="toolbar mt-12">
            <el-button @click="detailVisible = false">关闭</el-button>
            <div class="grow"></div>
            <el-button type="danger" @click="doApprove('REJECTED')">驳回</el-button>
            <el-button type="primary" @click="doApprove('APPROVED')">通过</el-button>
          </div>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from "vue";
import { Plus } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { http } from "../utils/http";
import { useUserStore } from "../stores/user";

const userStore = useUserStore();
const rows = ref<any[]>([]);
const chemicals = ref<any[]>([]);
const deptTree = ref<any[]>([]);
const orgs = ref<any[]>([]);
const createVisible = ref(false);
const detailVisible = ref(false);
const current = ref<any>(null);
const comment = ref("");

const form = ref<any>({ month: new Date().toISOString().slice(0, 7), departmentId: "", remark: "", items: [] });

const STATUS: Record<string, { label: string; type: any }> = {
  DRAFT: { label: "草稿", type: "info" },
  SECRETARY_SUBMITTED: { label: "已提交", type: "primary" },
  RESEARCH_APPROVED: { label: "科研处通过", type: "success" },
  SECURITY_APPROVED: { label: "保卫处通过", type: "success" },
  REJECTED: { label: "已驳回", type: "danger" },
  PURCHASING: { label: "采购中", type: "warning" },
  COMPLETED: { label: "已完成", type: "success" },
};
const statusLabel = (s: string) => STATUS[s]?.label || s;
const statusType = (s: string) => STATUS[s]?.type || "info";

function deptName(id: string) {
  const o = orgs.value.find((x) => x.id === id);
  return o?.name || id;
}

function canApprove(row: any) {
  const r = userStore.user?.role;
  if (!r) return false;
  const pending = row.approvals.find((a: any) => a.status === "PENDING");
  if (!pending) return false;
  if (pending.stepName === "科研处审核" && r === "RESEARCH_DEPT") return true;
  if (pending.stepName === "保卫处审核" && r === "SECURITY_OFFICER") return true;
  return false;
}

async function loadAll() {
  const [p, c, t, o] = await Promise.all([
    http.get("/procurement"),
    http.get("/chemicals"),
    http.get("/orgs/tree"),
    http.get("/orgs"),
  ]);
  rows.value = (p as any).data;
  chemicals.value = (c as any).data;
  deptTree.value = (t as any).data;
  orgs.value = (o as any).data;
}

function openCreate() {
  form.value = { month: new Date().toISOString().slice(0, 7), departmentId: "", remark: "", items: [] };
  addItem();
  createVisible.value = true;
}

function addItem() {
  form.value.items.push({ chemicalId: "", requestedQty: 0, suggestedQty: 0, estPrice: 50, remark: "" });
}

async function onChemChange(row: any, cid: string) {
  const ch = chemicals.value.find((c) => c.id === cid);
  if (!ch) return;
  try {
    const res: any = await http.post("/procurement/suggest", { chemicalIds: [cid], departmentId: form.value.departmentId || userStore.user?.orgId });
    const s = res.data?.[0];
    if (s) {
      row.suggestedQty = s.suggestedQty;
      if (!row.requestedQty) row.requestedQty = s.suggestedQty;
      if (s.overLimit) ElMessage.warning(`${ch.name} 触达采购上限，请谨慎申购`);
    }
  } catch {}
}

async function submit() {
  if (!form.value.departmentId) return ElMessage.warning("请选择院系");
  if (form.value.items.some((i: any) => !i.chemicalId)) return ElMessage.warning("请选择化学品");
  await http.post("/procurement", form.value);
  ElMessage.success("已提交，流转至科研处审核");
  createVisible.value = false;
  loadAll();
}

function openDetail(row: any) {
  current.value = row;
  detailVisible.value = true;
  comment.value = "";
}

const nextApproval = computed(() => current.value?.approvals.find((a: any) => a.status === "PENDING"));

const approvalStepIndex = computed(() => {
  if (!current.value) return 0;
  const idx = current.value.approvals.findIndex((a: any) => a.status === "PENDING");
  return idx === -1 ? current.value.approvals.length : idx;
});

async function approve(row: any) {
  openDetail(row);
}
async function doApprove(decision: "APPROVED" | "REJECTED") {
  const step = nextApproval.value;
  if (!step) return;
  await http.post(`/procurement/${current.value.id}/approve`, { stepName: step.stepName, decision, comment: comment.value });
  ElMessage.success("已审批");
  detailVisible.value = false;
  loadAll();
}

onMounted(loadAll);
</script>
