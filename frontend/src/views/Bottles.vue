<template>
  <div class="page">
    <div class="glass" style="padding:18px;">
      <div class="toolbar mb-12">
        <h3 class="panel-title" style="margin:0;"><span class="bar"></span>暂存台账（试剂瓶）</h3>
        <div class="grow"></div>
        <el-input v-model="q" placeholder="搜索追溯码 / RFID / 名称" style="width:260px;" clearable :prefix-icon="Search" @change="load" />
        <el-select v-model="status" placeholder="状态" clearable style="width:140px;" @change="load">
          <el-option v-for="s in STATUS" :key="s.value" :value="s.value" :label="s.label" />
        </el-select>
        <el-button type="primary" :icon="Plus" @click="openCreate">试剂入库</el-button>
      </div>
      <el-table :data="rows" stripe>
        <el-table-column label="追溯码" width="220">
          <template #default="{ row }">
            <code style="color:#00d2ff;">{{ row.traceCode }}</code>
          </template>
        </el-table-column>
        <el-table-column label="RFID" width="160" prop="rfidTag" />
        <el-table-column label="化学品" width="160">
          <template #default="{ row }">
            {{ row.chemical.name }}<br/>
            <span class="muted" style="font-size:12px;">{{ row.chemical.casNo }}</span>
          </template>
        </el-table-column>
        <el-table-column label="危化等级" width="120">
          <template #default="{ row }">
            <span class="tag-hazard" :class="`h-${row.chemical.hazardClass}`">{{ hazardLabel(row.chemical.hazardClass) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="供应商" prop="supplier" width="120" />
        <el-table-column label="批次" prop="batchNo" width="140" />
        <el-table-column label="位置" width="220">
          <template #default="{ row }">{{ row.locationOrg.name }} · {{ row.cabinet || '-' }}</template>
        </el-table-column>
        <el-table-column label="剩余 / 初始" width="140">
          <template #default="{ row }">
            {{ row.remainingQty }} / {{ row.initialQty }} {{ row.unit }}
            <div v-if="row.remainingQty < row.initialQty * 0.1" style="color:#ef4444; font-size:12px;">低库存</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><span class="status-tag" :class="`status-${row.status}`">{{ statusLabel(row.status) }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="180">
          <template #default="{ row }">
            <el-button size="small" link @click="showQR(row)">二维码</el-button>
            <el-button size="small" link type="primary" @click="trace(row.traceCode)">追溯</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="createVisible" title="试剂入库" width="640px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="化学品">
          <el-select v-model="form.chemicalId" filterable style="width:100%;">
            <el-option v-for="c in chemicals" :key="c.id" :value="c.id" :label="`${c.name} (${c.casNo})`" />
          </el-select>
        </el-form-item>
        <el-form-item label="批次号"><el-input v-model="form.batchNo" /></el-form-item>
        <el-form-item label="供应商"><el-input v-model="form.supplier" /></el-form-item>
        <el-form-item label="生产日期"><el-date-picker v-model="form.manufactureDate" type="date" value-format="YYYY-MM-DD" style="width:100%;" /></el-form-item>
        <el-form-item label="有效期"><el-date-picker v-model="form.expireDate" type="date" value-format="YYYY-MM-DD" style="width:100%;" /></el-form-item>
        <el-form-item label="初始量"><el-input-number v-model="form.initialQty" :min="0" /></el-form-item>
        <el-form-item label="单位"><el-input v-model="form.unit" /></el-form-item>
        <el-form-item label="暂存位置">
          <el-tree-select v-model="form.locationOrgId" :data="orgTree" check-strictly :props="{ value: 'id', label: 'name' }" style="width:100%;" />
        </el-form-item>
        <el-form-item label="柜号"><el-input v-model="form.cabinet" /></el-form-item>
        <el-form-item label="检验报告">
          <el-upload :auto-upload="false" :on-change="onFile" :show-file-list="false" accept=".pdf,.jpg,.png">
            <el-button>{{ form.inspectionReport ? '已选择' : '点击上传' }}</el-button>
          </el-upload>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">入库</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="qrVisible" title="追溯码" width="320px" align-center>
      <div style="text-align:center;">
        <div class="qr-box"><canvas ref="qrCanvas" /></div>
        <div class="mt-12">{{ current?.traceCode }}</div>
        <div class="muted">RFID: {{ current?.rfidTag }}</div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, nextTick } from "vue";
import { useRouter } from "vue-router";
import { Plus, Search } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import QRCode from "qrcode";
import { http } from "../utils/http";

const router = useRouter();
const q = ref("");
const status = ref("");
const rows = ref<any[]>([]);
const chemicals = ref<any[]>([]);
const orgTree = ref<any[]>([]);
const createVisible = ref(false);
const qrVisible = ref(false);
const current = ref<any>(null);
const qrCanvas = ref<any>(null);

const STATUS = [
  { value: "IN_STORAGE", label: "在库" },
  { value: "RESERVED", label: "已预留" },
  { value: "IN_USE", label: "在用" },
  { value: "DEPLETED", label: "耗尽" },
  { value: "RECYCLING", label: "回收中" },
  { value: "DESTROYED", label: "已销毁" },
];
const HAZARD: Record<string, string> = {
  PRECURSOR_DRUG: "易制毒",
  EXPLOSIVE_PRECURSOR: "易制爆",
  HIGHLY_TOXIC: "剧毒",
  CORROSIVE: "腐蚀品",
  FLAMMABLE: "易燃",
  OXIDIZER: "氧化剂",
  REACTIVE: "高活性",
  GENERAL: "常规",
};
const statusLabel = (s: string) => STATUS.find((x) => x.value === s)?.label || s;
const hazardLabel = (s: string) => HAZARD[s] || s;

const form = ref<any>({ chemicalId: "", batchNo: "", supplier: "", manufactureDate: "", expireDate: "", initialQty: 1000, unit: "mL", locationOrgId: "", cabinet: "", inspectionReport: "" });

async function load() {
  const res: any = await http.get("/bottles", { params: { q: q.value, status: status.value } });
  rows.value = res.data;
}
async function loadMeta() {
  const [c, t] = await Promise.all([http.get("/chemicals"), http.get("/orgs/tree")]);
  chemicals.value = (c as any).data;
  orgTree.value = (t as any).data;
}

function openCreate() {
  form.value = { chemicalId: "", batchNo: "", supplier: "", manufactureDate: "", expireDate: "", initialQty: 1000, unit: "mL", locationOrgId: "", cabinet: "", inspectionReport: "" };
  createVisible.value = true;
}

function onFile(file: any) {
  // mock：实际项目应该上传到 OSS / 本地
  form.value.inspectionReport = file.name;
}

async function submit() {
  if (!form.value.chemicalId || !form.value.locationOrgId) return ElMessage.warning("请完善必填项");
  await http.post("/bottles", form.value);
  ElMessage.success("入库成功，追溯码已生成");
  createVisible.value = false;
  load();
}

async function showQR(row: any) {
  current.value = row;
  qrVisible.value = true;
  await nextTick();
  if (qrCanvas.value) await QRCode.toCanvas(qrCanvas.value, row.traceCode, { width: 200 });
}

function trace(code: string) {
  router.push(`/audit?code=${encodeURIComponent(code)}`);
}

onMounted(() => {
  load();
  loadMeta();
});
</script>
