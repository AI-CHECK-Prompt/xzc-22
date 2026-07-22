<template>
  <div class="page">
    <div class="row-2-equal">
      <div class="glass" style="padding:18px;">
        <h3 class="panel-title"><span class="bar"></span>废液桶</h3>
        <el-table :data="buckets" size="small">
          <el-table-column prop="bucketNo" label="桶号" width="150" />
          <el-table-column label="类别" width="100">
            <template #default="{ row }"><el-tag>{{ catLabel(row.category) }}</el-tag></template>
          </el-table-column>
          <el-table-column label="所属">
            <template #default="{ row }">{{ row.ownerOrg.name }}</template>
          </el-table-column>
          <el-table-column label="容量" width="140">
            <template #default="{ row }">{{ row.currentVolume }} / {{ row.capacity }} L</template>
          </el-table-column>
          <el-table-column label="位置" prop="locatedAt" />
          <el-table-column label="状态" width="120">
            <template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template>
          </el-table-column>
        </el-table>
      </div>

      <div class="glass" style="padding:18px;">
        <h3 class="panel-title"><span class="bar"></span>电子交接</h3>
        <el-form :model="form" label-width="100px">
          <el-form-item label="废液桶">
            <el-select v-model="form.bucketId" filterable style="width:100%;">
              <el-option v-for="b in buckets" :key="b.id" :value="b.id" :label="`${b.bucketNo} · ${catLabel(b.category)} · ${b.ownerOrg.name}`" />
            </el-select>
          </el-form-item>
          <el-form-item label="倒入类别">
            <el-select v-model="form.category" style="width:100%;">
              <el-option v-for="c in CATS" :key="c.value" :value="c.value" :label="c.label" />
            </el-select>
          </el-form-item>
          <el-form-item label="相容性">
            <el-tag v-if="compat === null" type="info">未选择</el-tag>
            <el-tag v-else-if="compat" type="success">相容，可倒入</el-tag>
            <el-tag v-else type="danger">不相容，禁止倒入</el-tag>
            <el-button link type="primary" class="mt-12" @click="checkCompat">校验相容性</el-button>
          </el-form-item>
          <el-form-item label="接收方院系">
            <el-tree-select v-model="form.toOrgId" :data="orgTree" check-strictly :props="{ value: 'id', label: 'name' }" style="width:100%;" />
          </el-form-item>
          <el-form-item label="重量"><el-input-number v-model="form.weight" :min="0" :precision="2" /> L</el-form-item>
          <el-form-item label="备注"><el-input v-model="form.remark" /></el-form-item>
          <el-button type="primary" @click="handoff" :disabled="!form.bucketId || !form.toOrgId" style="width:100%;">提交交接</el-button>
        </el-form>
      </div>
    </div>

    <div class="glass" style="padding:18px;">
      <h3 class="panel-title"><span class="bar"></span>交接流水</h3>
      <el-table :data="handoffs" size="small">
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ new Date(row.handoverAt).toLocaleString("zh-CN") }}</template>
        </el-table-column>
        <el-table-column label="桶号" prop="bucket.bucketNo" width="160" />
        <el-table-column label="类别" width="100">
          <template #default="{ row }">{{ catLabel(row.category) }}</template>
        </el-table-column>
        <el-table-column label="重量" width="100">
          <template #default="{ row }">{{ row.weight }} L</template>
        </el-table-column>
        <el-table-column label="接收方" prop="toOrgId" />
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="confirm(row)" v-if="!confirmed(row)">扫码确认</el-button>
            <el-tag v-else type="success" size="small">已确认</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { http } from "../utils/http";
import { useUserStore } from "../stores/user";

const userStore = useUserStore();
const buckets = ref<any[]>([]);
const handoffs = ref<any[]>([]);
const orgTree = ref<any[]>([]);
const compat = ref<boolean | null>(null);
const form = ref<any>({ bucketId: "", category: "ORGANIC", toOrgId: "", weight: 0, remark: "" });

const CATS = [
  { value: "ORGANIC", label: "有机废液" },
  { value: "HEAVY_METAL", label: "重金属" },
  { value: "ACID", label: "酸性" },
  { value: "ALKALI", label: "碱性" },
  { value: "OXIDIZER", label: "氧化性" },
];
const STATUS = [
  { value: "IDLE", label: "空闲", type: "info" },
  { value: "FILLING", label: "收集中", type: "primary" },
  { value: "PENDING_HANDOVER", label: "待交接", type: "warning" },
  { value: "SEALED", label: "已封桶", type: "success" },
  { value: "DISPATCHED", label: "已清运", type: "success" },
];
const catLabel = (c: string) => CATS.find((x) => x.value === c)?.label || c;
const statusLabel = (s: string) => STATUS.find((x) => x.value === s)?.label || s;
const statusType = (s: string) => STATUS.find((x) => x.value === s)?.type || "info";

async function load() {
  const [b, h, t] = await Promise.all([http.get("/waste/buckets"), http.get("/waste/handoffs"), http.get("/orgs/tree")]);
  buckets.value = (b as any).data;
  handoffs.value = (h as any).data;
  orgTree.value = (t as any).data;
}

async function checkCompat() {
  if (!form.value.bucketId) return;
  const b = buckets.value.find((x) => x.id === form.value.bucketId);
  if (!b) return;
  const res: any = await http.post("/waste/compat-check", { bucketCategory: b.category, incomingCategory: form.value.category });
  compat.value = res.data.compatible;
  if (!compat.value) ElMessage.warning("相容性校验失败，请检查类别");
}

watch(() => form.value.bucketId, () => (compat.value = null));
watch(() => form.value.category, () => (compat.value = null));

async function handoff() {
  await http.post("/waste/handoff", form.value);
  ElMessage.success("已发起交接，等待对方扫码确认");
  load();
}

function confirmed(row: any) {
  return row.toUserId && row.toUserId !== row.fromUserId;
}

async function confirm(row: any) {
  await http.post(`/waste/handoff/${row.id}/confirm`);
  ElMessage.success("已确认交接");
  load();
}

onMounted(load);
</script>
