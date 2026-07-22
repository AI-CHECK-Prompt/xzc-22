<template>
  <div class="page">
    <div class="glass" style="padding:18px;">
      <div class="toolbar mb-12">
        <h3 class="panel-title" style="margin:0;"><span class="bar"></span>领用申请</h3>
        <div class="grow"></div>
        <el-button type="primary" :icon="Plus" @click="openCreate">新建领用</el-button>
      </div>
      <el-table :data="rows" stripe>
        <el-table-column prop="reqNo" label="申请单号" width="180" />
        <el-table-column label="申请人" width="120">
          <template #default="{ row }">{{ row.applicant.fullName }}</template>
        </el-table-column>
        <el-table-column prop="projectCode" label="项目编号" width="140" />
        <el-table-column prop="purpose" label="用途" />
        <el-table-column label="预期时间" width="160">
          <template #default="{ row }">{{ new Date(row.expectedTime).toLocaleString("zh-CN") }}</template>
        </el-table-column>
        <el-table-column label="瓶数" width="80">
          <template #default="{ row }">{{ row.bottles.length }}</template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }"><el-tag :type="reqType(row.status)">{{ reqLabel(row.status) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button size="small" link @click="openDetail(row)">查看</el-button>
            <el-button v-if="canApprove(row)" size="small" type="primary" link @click="openDetail(row)">审批</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="createVisible" title="新建领用申请" width="780px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="项目编号"><el-input v-model="form.projectCode" /></el-form-item>
        <el-form-item label="用途"><el-input v-model="form.purpose" /></el-form-item>
        <el-form-item label="预期时间"><el-date-picker v-model="form.expectedTime" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" style="width:100%;" /></el-form-item>
        <el-form-item label="选择试剂瓶">
          <el-button size="small" @click="addBottle">添加</el-button>
        </el-form-item>
        <el-table :data="form.bottles" border>
          <el-table-column label="追溯码">
            <template #default="{ row }">
              <el-select v-model="row.bottleId" filterable style="width:100%;">
                <el-option v-for="b in bottles" :key="b.id" :value="b.id" :label="`${b.traceCode} · ${b.chemical.name} · 剩 ${b.remainingQty}${b.unit}`" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="数量" width="140">
            <template #default="{ row }"><el-input-number v-model="row.requestedQty" :min="0" size="small" style="width:120px;" /></template>
          </el-table-column>
          <el-table-column label="操作" width="80">
            <template #default="{ $index }"><el-button size="small" type="danger" link @click="form.bottles.splice($index,1)">删除</el-button></template>
          </el-table-column>
        </el-table>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">提交申请</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="detailVisible" :title="current?.reqNo" size="640px">
      <div v-if="current">
        <div class="kpi-grid" style="grid-template-columns:1fr 1fr;">
          <div class="kpi"><div class="label">申请人</div><div class="value" style="font-size:18px;">{{ current.applicant.fullName }}</div></div>
          <div class="kpi"><div class="label">项目编号</div><div class="value" style="font-size:18px;">{{ current.projectCode || '-' }}</div></div>
          <div class="kpi"><div class="label">用途</div><div class="value" style="font-size:14px;">{{ current.purpose }}</div></div>
          <div class="kpi"><div class="label">预期时间</div><div class="value" style="font-size:14px;">{{ new Date(current.expectedTime).toLocaleString("zh-CN") }}</div></div>
        </div>
        <h4 class="panel-title"><span class="bar"></span>审批流</h4>
        <el-steps :active="stepIndex" finish-status="success" direction="vertical">
          <el-step v-for="a in current.approvals" :key="a.id" :title="a.stepName" :description="a.comment || (a.status === 'PENDING' ? '待审批' : (a.approver?.fullName || ''))" :status="a.status === 'REJECTED' ? 'error' : (a.status === 'APPROVED' ? 'success' : 'process')" />
        </el-steps>
        <h4 class="panel-title mt-12"><span class="bar"></span>试剂瓶</h4>
        <el-table :data="current.bottles" size="small">
          <el-table-column label="追溯码" width="220">
            <template #default="{ row }"><code style="color:#00d2ff;">{{ row.bottle.traceCode }}</code></template>
          </el-table-column>
          <el-table-column label="化学品"><template #default="{ row }">{{ row.bottle.chemical.name }}</template></el-table-column>
          <el-table-column label="危化等级" width="120">
            <template #default="{ row }">
              <span class="tag-hazard" :class="`h-${row.bottle.chemical.hazardClass}`">{{ hazardLabel(row.bottle.chemical.hazardClass) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="数量" prop="requestedQty" width="80" />
        </el-table>
        <div v-if="canApprove(current)" class="mt-12">
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
import { computed, onMounted, ref } from "vue";
import { Plus } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { http } from "../utils/http";
import { useUserStore } from "../stores/user";

const userStore = useUserStore();
const rows = ref<any[]>([]);
const bottles = ref<any[]>([]);
const createVisible = ref(false);
const detailVisible = ref(false);
const current = ref<any>(null);
const comment = ref("");
const form = ref<any>({ projectCode: "", purpose: "", expectedTime: new Date().toISOString().slice(0, 19).replace("T", " "), bottles: [] });

const HAZARD: Record<string, string> = {
  PRECURSOR_DRUG: "易制毒", EXPLOSIVE_PRECURSOR: "易制爆", HIGHLY_TOXIC: "剧毒", CORROSIVE: "腐蚀", FLAMMABLE: "易燃", OXIDIZER: "氧化", REACTIVE: "高活性", GENERAL: "常规",
};
const hazardLabel = (s: string) => HAZARD[s] || s;
const REQ: Record<string, { label: string; type: any }> = {
  PENDING: { label: "审批中", type: "warning" },
  APPROVED: { label: "已通过", type: "success" },
  REJECTED: { label: "已驳回", type: "danger" },
  VERIFYING: { label: "核验中", type: "primary" },
  COMPLETED: { label: "已完成", type: "success" },
  CANCELLED: { label: "已取消", type: "info" },
};
const reqLabel = (s: string) => REQ[s]?.label || s;
const reqType = (s: string) => REQ[s]?.type || "info";

const stepIndex = computed(() => {
  if (!current.value) return 0;
  const idx = current.value.approvals.findIndex((a: any) => a.status === "PENDING");
  return idx === -1 ? current.value.approvals.length : idx;
});

function canApprove(row: any) {
  const r = userStore.user?.role;
  if (!r) return false;
  const step = row.approvals.find((a: any) => a.status === "PENDING");
  if (!step) return false;
  if (step.stepName === "导师审核" && r === "MENTOR") return true;
  if (step.stepName === "项目负责人审核" && r === "PROJECT_LEAD") return true;
  if (step.stepName === "危化品管理员审核" && r === "HAZMAT_ADMIN") return true;
  return false;
}

async function load() {
  const [r, b] = await Promise.all([http.get("/requisitions"), http.get("/bottles")]);
  rows.value = (r as any).data;
  bottles.value = (b as any).data;
}

function openCreate() {
  form.value = { projectCode: "", purpose: "", expectedTime: new Date().toISOString().slice(0, 19).replace("T", " "), bottles: [] };
  addBottle();
  createVisible.value = true;
}
function addBottle() { form.value.bottles.push({ bottleId: "", requestedQty: 100 }); }

async function submit() {
  if (!form.value.purpose) return ElMessage.warning("请填写用途");
  if (form.value.bottles.some((b: any) => !b.bottleId)) return ElMessage.warning("请选择试剂瓶");
  await http.post("/requisitions", form.value);
  ElMessage.success("领用申请已提交");
  createVisible.value = false;
  load();
}

function openDetail(row: any) {
  http.get(`/requisitions/${row.id}`).then((res: any) => {
    current.value = res.data;
    detailVisible.value = true;
    comment.value = "";
  });
}

async function doApprove(decision: "APPROVED" | "REJECTED") {
  const step = current.value.approvals.find((a: any) => a.status === "PENDING");
  if (!step) return;
  await http.post(`/requisitions/${current.value.id}/approve`, { stepName: step.stepName, decision, comment: comment.value });
  ElMessage.success("已审批");
  detailVisible.value = false;
  load();
}

onMounted(load);
</script>
