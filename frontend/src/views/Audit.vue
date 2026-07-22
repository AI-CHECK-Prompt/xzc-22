<template>
  <div class="page">
    <div class="glass" style="padding:18px;">
      <h3 class="panel-title"><span class="bar"></span>追溯码全链路回溯</h3>
      <div style="display:flex; gap:8px; align-items:center;">
        <el-input v-model="code" placeholder="输入追溯码" size="large" :prefix-icon="Search" @keyup.enter="trace" style="max-width:520px;" />
        <el-button type="primary" size="large" @click="trace">追溯</el-button>
      </div>
    </div>

    <div v-if="bottle" class="row-2-equal">
      <div class="glass" style="padding:18px;">
        <h3 class="panel-title"><span class="bar"></span>试剂档案</h3>
        <div class="kpi-grid" style="grid-template-columns:1fr 1fr;">
          <div class="kpi"><div class="label">追溯码</div><div class="value" style="font-size:14px;">{{ bottle.traceCode }}</div></div>
          <div class="kpi"><div class="label">RFID</div><div class="value" style="font-size:14px;">{{ bottle.rfidTag }}</div></div>
          <div class="kpi"><div class="label">化学品</div><div class="value" style="font-size:18px;">{{ bottle.chemical.name }}</div></div>
          <div class="kpi warn"><div class="label">危化等级</div><div class="value" style="font-size:18px;">{{ hazardLabel(bottle.chemical.hazardClass) }}</div></div>
          <div class="kpi"><div class="label">供应商</div><div class="value" style="font-size:18px;">{{ bottle.supplier }}</div></div>
          <div class="kpi"><div class="label">批次</div><div class="value" style="font-size:18px;">{{ bottle.batchNo }}</div></div>
          <div class="kpi"><div class="label">位置</div><div class="value" style="font-size:14px;">{{ bottle.locationOrg.name }} · {{ bottle.cabinet }}</div></div>
          <div class="kpi"><div class="label">剩余 / 初始</div><div class="value" style="font-size:18px;">{{ bottle.remainingQty }} / {{ bottle.initialQty }} {{ bottle.unit }}</div></div>
        </div>
      </div>

      <div class="glass" style="padding:18px;">
        <h3 class="panel-title"><span class="bar"></span>审计事件流</h3>
        <div class="timeline-card">
          <div v-for="e in events" :key="e.id" class="ev">
            <div class="flex-between">
              <div>
                <span class="what">{{ e.action }}</span>
                <span class="muted" style="margin-left:8px;">{{ e.entityType }} · {{ e.actor?.fullName || '系统' }}</span>
              </div>
              <div class="when">{{ new Date(e.occurredAt).toLocaleString("zh-CN") }}</div>
            </div>
            <div v-if="e.payload" class="muted" style="font-size:12px; margin-top:4px;">
              <pre style="margin:0; white-space:pre-wrap; word-break:break-all;">{{ JSON.stringify(e.payload, null, 0) }}</pre>
            </div>
          </div>
          <div v-if="!events.length" class="empty-tip">暂无审计事件</div>
        </div>
        <h3 class="panel-title mt-12"><span class="bar"></span>领用与核验</h3>
        <div v-for="r in requisitions" :key="r.id" class="kpi" style="margin-bottom:8px;">
          <div class="flex-between">
            <div><b>{{ r.reqNo }}</b> · {{ r.applicant.fullName }} · {{ r.purpose }}</div>
            <el-tag :type="r.status === 'COMPLETED' ? 'success' : (r.status === 'REJECTED' ? 'danger' : 'warning')">{{ r.status }}</el-tag>
          </div>
          <div v-if="r.verification" class="muted" style="font-size:12px;">
            双人核验：{{ r.verification.userA.fullName }} + {{ r.verification.userB.fullName }} @ {{ r.verification.locationDesc || '未提供' }}
          </div>
        </div>
        <h3 class="panel-title mt-12"><span class="bar"></span>使用登记</h3>
        <el-table :data="usage" size="small">
          <el-table-column label="时间" width="170">
            <template #default="{ row }">{{ new Date(row.loggedAt).toLocaleString("zh-CN") }}</template>
          </el-table-column>
          <el-table-column label="使用人" prop="user.fullName" width="100" />
          <el-table-column label="用量" prop="qty" width="80" />
          <el-table-column label="剩余" prop="remaining" width="80" />
          <el-table-column label="实验" prop="experiment" />
        </el-table>
        <h3 class="panel-title mt-12"><span class="bar"></span>空瓶操作</h3>
        <el-table :data="empties" size="small">
          <el-table-column label="时间" width="170">
            <template #default="{ row }">{{ new Date(row.operatedAt).toLocaleString("zh-CN") }}</template>
          </el-table-column>
          <el-table-column label="操作" prop="opType" width="120" />
          <el-table-column label="操作人" prop="operator.fullName" />
          <el-table-column label="备注" prop="note" />
        </el-table>
      </div>
    </div>

    <div v-else class="glass" style="padding:18px;">
      <div class="empty-tip">请输入追溯码开始追溯</div>
    </div>

    <div class="glass" style="padding:18px;">
      <h3 class="panel-title"><span class="bar"></span>数据补录（保证追溯链路完整）</h3>
      <el-form :model="backfill" label-width="100px">
        <el-form-item label="追溯码"><el-input v-model="backfill.traceCode" /></el-form-item>
        <el-form-item label="动作"><el-input v-model="backfill.action" placeholder="例如 HISTORIC_INBOUND" /></el-form-item>
        <el-form-item label="实体类型"><el-input v-model="backfill.entityType" placeholder="例如 bottle" /></el-form-item>
        <el-form-item label="实体ID"><el-input v-model="backfill.entityId" /></el-form-item>
        <el-form-item label="发生时间"><el-date-picker v-model="backfill.occurredAt" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" style="width:100%;" /></el-form-item>
        <el-form-item label="附加数据"><el-input v-model="backfill.payload" type="textarea" :rows="3" placeholder='{"note":"手工补录 2025 年入库"}' /></el-form-item>
        <el-button type="primary" @click="doBackfill">写入补录事件</el-button>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { Search } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { http } from "../utils/http";

const route = useRoute();
const code = ref("");
const bottle = ref<any>(null);
const events = ref<any[]>([]);
const requisitions = ref<any[]>([]);
const usage = ref<any[]>([]);
const empties = ref<any[]>([]);
const backfill = ref<any>({ traceCode: "", action: "", entityType: "bottle", entityId: "", occurredAt: "", payload: "" });

const HAZARD: Record<string, string> = { PRECURSOR_DRUG: "易制毒", EXPLOSIVE_PRECURSOR: "易制爆", HIGHLY_TOXIC: "剧毒", CORROSIVE: "腐蚀", FLAMMABLE: "易燃", OXIDIZER: "氧化", REACTIVE: "高活性", GENERAL: "常规" };
const hazardLabel = (s: string) => HAZARD[s] || s;

async function trace() {
  if (!code.value) return;
  const res: any = await http.get(`/audit/trace/${encodeURIComponent(code.value)}`);
  bottle.value = res.data.bottle;
  events.value = res.data.events;
  requisitions.value = res.data.requisitions;
  usage.value = res.data.usage;
  empties.value = res.data.empties;
}

async function doBackfill() {
  let payload: any = {};
  if (backfill.value.payload) {
    try { payload = JSON.parse(backfill.value.payload); } catch { return ElMessage.warning("附加数据需为 JSON"); }
  }
  await http.post("/audit/backfill", { ...backfill.value, payload });
  ElMessage.success("补录事件已写入审计流水");
  if (code.value === backfill.value.traceCode) trace();
}

onMounted(() => {
  const c = route.query.code as string;
  if (c) {
    code.value = c;
    trace();
  }
});
</script>
