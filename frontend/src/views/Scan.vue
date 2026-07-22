<template>
  <div class="page">
    <div class="row-2-equal">
      <div class="glass" style="padding:18px;">
        <h3 class="panel-title"><span class="bar"></span>扫码核验</h3>
        <el-input v-model="code" placeholder="输入或粘贴追溯码（CHEM:xxx:xxxx）" size="large" :prefix-icon="Search" @keyup.enter="scan" />
        <el-button class="mt-12" type="primary" size="large" @click="scan" style="width:100%;">立即核验</el-button>
        <el-divider>或</el-divider>
        <div class="muted" style="line-height:1.8;">
          在生产环境中，本页面将启用 WebRTC 摄像头扫码。可输入追溯码模拟现场扫码流程。
        </div>
      </div>
      <div class="glass" style="padding:18px;" v-if="bottle">
        <h3 class="panel-title"><span class="bar"></span>试剂详情</h3>
        <div class="kpi-grid" style="grid-template-columns:1fr 1fr; margin-bottom:0;">
          <div class="kpi"><div class="label">追溯码</div><div class="value" style="font-size:14px; word-break:break-all;">{{ bottle.traceCode }}</div></div>
          <div class="kpi"><div class="label">RFID</div><div class="value" style="font-size:14px;">{{ bottle.rfidTag }}</div></div>
          <div class="kpi"><div class="label">化学品</div><div class="value" style="font-size:18px;">{{ bottle.chemical.name }}</div></div>
          <div class="kpi warn"><div class="label">危化等级</div><div class="value" style="font-size:18px;">{{ hazardLabel(bottle.chemical.hazardClass) }}</div></div>
          <div class="kpi"><div class="label">供应商</div><div class="value" style="font-size:18px;">{{ bottle.supplier }}</div></div>
          <div class="kpi"><div class="label">批次</div><div class="value" style="font-size:18px;">{{ bottle.batchNo }}</div></div>
          <div class="kpi"><div class="label">位置</div><div class="value" style="font-size:14px;">{{ bottle.locationOrg.name }} · {{ bottle.cabinet || '-' }}</div></div>
          <div class="kpi"><div class="label">剩余量</div><div class="value">{{ bottle.remainingQty }} / {{ bottle.initialQty }} {{ bottle.unit }}</div></div>
        </div>
      </div>
      <div v-else class="glass" style="padding:18px;">
        <div class="empty-tip">暂无数据，请先扫码</div>
      </div>
    </div>

    <div v-if="bottle" class="glass" style="padding:18px;">
      <h3 class="panel-title"><span class="bar"></span>近期使用</h3>
      <el-table :data="bottle.usageLogs" size="small">
        <el-table-column label="时间" width="180">
          <template #default="{ row }">{{ new Date(row.loggedAt).toLocaleString("zh-CN") }}</template>
        </el-table-column>
        <el-table-column label="使用人" prop="user.fullName" width="120" />
        <el-table-column label="用量" prop="qty" width="100" />
        <el-table-column label="剩余" prop="remaining" width="100" />
        <el-table-column label="实验" prop="experiment" />
        <el-table-column label="备注" prop="content" />
        <el-table-column label="离线" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.offline" type="warning" size="small">离线同步</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { Search } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { http } from "../utils/http";

const code = ref("");
const bottle = ref<any>(null);

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
const hazardLabel = (s: string) => HAZARD[s] || s;

async function scan() {
  if (!code.value) return ElMessage.warning("请输入追溯码");
  try {
    const res: any = await http.get(`/bottles/scan/${encodeURIComponent(code.value)}`);
    bottle.value = res.data;
  } catch {}
}
</script>
