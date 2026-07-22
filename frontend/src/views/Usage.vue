<template>
  <div class="page">
    <div class="row-2-equal">
      <div class="glass" style="padding:18px;">
        <h3 class="panel-title"><span class="bar"></span>扫码登记用量</h3>
        <el-form :model="form" label-width="100px">
          <el-form-item label="追溯码">
            <el-input v-model="traceCode" placeholder="扫码或粘贴追溯码" :prefix-icon="Camera" @keyup.enter="lookup" />
            <el-button class="mt-12" @click="lookup" :disabled="!traceCode">查询试剂</el-button>
          </el-form-item>
          <template v-if="bottle">
            <el-form-item label="化学品">
              <div>{{ bottle.chemical.name }} · <span class="muted">{{ bottle.chemical.casNo }}</span></div>
            </el-form-item>
            <el-form-item label="剩余量">
              <div>{{ bottle.remainingQty }} / {{ bottle.initialQty }} {{ bottle.unit }}</div>
            </el-form-item>
            <el-form-item label="使用量">
              <el-input-number v-model="form.qty" :min="0" :max="bottle.remainingQty" />
              <span class="muted" style="margin-left:8px;">{{ bottle.unit }}</span>
            </el-form-item>
            <el-form-item label="实验内容"><el-input v-model="form.experiment" /></el-form-item>
            <el-form-item label="备注"><el-input v-model="form.content" type="textarea" :rows="2" /></el-form-item>
            <el-form-item label="剩余去向"><el-input v-model="form.nextUse" /></el-form-item>
            <el-button type="primary" @click="submit" style="width:100%;">提交登记</el-button>
          </template>
        </el-form>
      </div>
      <div class="glass" style="padding:18px;">
        <h3 class="panel-title"><span class="bar"></span>离线缓存</h3>
        <div class="muted" style="line-height:1.8;">
          当现场无网络时，点击"离线暂存"将记录写入本地 IndexedDB，待网络恢复后点击"批量同步"自动重放至服务端。
        </div>
        <div class="kpi-grid" style="grid-template-columns:1fr 1fr;">
          <div class="kpi"><div class="label">本地暂存数</div><div class="value">{{ localList.length }}</div></div>
          <div class="kpi"><div class="label">同步中</div><div class="value">{{ syncing ? '是' : '否' }}</div></div>
        </div>
        <el-button class="mt-12" @click="sync" type="primary" style="width:100%;">批量同步</el-button>
        <el-table :data="localList" size="small" class="mt-12" max-height="300">
          <el-table-column label="追溯码" prop="traceCode" />
          <el-table-column label="用量" prop="qty" width="80" />
          <el-table-column label="实验" prop="experiment" />
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Camera } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { http } from "../utils/http";

const traceCode = ref("");
const bottle = ref<any>(null);
const form = ref<any>({ qty: 0, experiment: "", content: "", nextUse: "" });
const localList = ref<any[]>([]);
const syncing = ref(false);

const LOCAL_KEY = "chem-usage-offline";

function loadLocal() {
  const raw = localStorage.getItem(LOCAL_KEY);
  localList.value = raw ? JSON.parse(raw) : [];
}
function saveLocal() {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(localList.value));
}

async function lookup() {
  try {
    const res: any = await http.get(`/bottles/scan/${encodeURIComponent(traceCode.value)}`);
    bottle.value = res.data;
    form.value.qty = 0;
  } catch {
    bottle.value = null;
  }
}

async function submit() {
  if (!bottle.value) return;
  if (form.value.qty <= 0) return ElMessage.warning("请输入使用量");
  try {
    const res: any = await http.post("/usage", { bottleId: bottle.value.id, ...form.value, loggedAt: new Date().toISOString(), offline: false });
    if (res.data?.alert) ElMessage.warning(res.data.alert);
    ElMessage.success("使用登记已提交");
    bottle.value = null;
    traceCode.value = "";
  } catch {
    // 失败：写入离线队列
    localList.value.push({ clientId: `cli-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, bottleId: bottle.value.id, traceCode: traceCode.value, qty: form.value.qty, experiment: form.value.experiment, content: form.value.content, nextUse: form.value.nextUse, loggedAt: new Date().toISOString() });
    saveLocal();
    ElMessage.warning("网络异常，已暂存至本地，恢复网络后自动同步");
    bottle.value = null;
    traceCode.value = "";
  }
}

async function sync() {
  if (localList.value.length === 0) return ElMessage.info("本地无待同步数据");
  syncing.value = true;
  try {
    await http.post("/usage/sync", { items: localList.value });
    localList.value = [];
    saveLocal();
    ElMessage.success("离线数据已全部同步");
  } catch {} finally {
    syncing.value = false;
  }
}

onMounted(() => {
  loadLocal();
  // 监听网络恢复
  window.addEventListener("online", () => {
    if (localList.value.length) sync();
  });
});
</script>
