<template>
  <div class="page">
    <div class="row-2-equal">
      <div class="glass" style="padding:18px;">
        <h3 class="panel-title"><span class="bar"></span>对接目标</h3>
        <el-table :data="targets" size="small">
          <el-table-column prop="name" label="对接方" />
          <el-table-column label="操作" width="120">
            <template #default="{ row }">
              <el-button size="small" type="primary" link @click="pushTo(row.key)">推送</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-form label-width="100px" class="mt-12">
          <el-form-item label="上报周期">
            <el-date-picker v-model="period" type="month" value-format="YYYY-MM" />
          </el-form-item>
        </el-form>
      </div>
      <div class="glass" style="padding:18px;">
        <h3 class="panel-title"><span class="bar"></span>对接说明</h3>
        <p style="line-height:1.9; color:var(--ink-1);">
          平台预置与公安、生态环境、教育主管部门、保卫处四方监管系统的对接能力，采用适配器模式以确保真实环境零侵入替换。
          <br/><br/>
          · <b>公安易制毒</b>：按月上报易制毒化学品的购买与库存台账。<br/>
          · <b>生态环境</b>：按月汇总危废产生量与处置记录。<br/>
          · <b>教育主管部门</b>：按学期自动汇总实验室安全报表。<br/>
          · <b>保卫部门</b>：实时同步双人核验与门禁记录。
        </p>
      </div>
    </div>

    <div class="glass" style="padding:18px;">
      <h3 class="panel-title"><span class="bar"></span>上报历史</h3>
      <el-table :data="reports" size="small">
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ new Date(row.submittedAt).toLocaleString("zh-CN") }}</template>
        </el-table-column>
        <el-table-column label="对接方" width="240">
          <template #default="{ row }">{{ targetName(row.target) }}</template>
        </el-table-column>
        <el-table-column label="周期" prop="period" width="100" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><el-tag :type="row.status === 'SUCCESS' ? 'success' : 'danger'">{{ row.status }}</el-tag></template>
        </el-table-column>
        <el-table-column label="回执" prop="response" />
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "../utils/http";

const targets = ref<any[]>([]);
const reports = ref<any[]>([]);
const period = ref(new Date().toISOString().slice(0, 7));

async function load() {
  const [t, r] = await Promise.all([http.get("/compliance/targets"), http.get("/compliance/reports")]);
  targets.value = (t as any).data;
  reports.value = (r as any).data;
}

function targetName(k: string) { return targets.value.find((x) => x.key === k)?.name || k; }

async function pushTo(key: string) {
  await http.post(`/compliance/push/${key}`, { period: period.value });
  ElMessage.success("已上报");
  load();
}

onMounted(load);
</script>
