<template>
  <div class="page">
    <div class="row-2-equal">
      <div class="glass" style="padding:18px;">
        <h3 class="panel-title"><span class="bar"></span>空瓶记录</h3>
        <el-form :model="form" label-width="100px">
          <el-form-item label="追溯码">
            <el-input v-model="traceCode" placeholder="扫描或输入追溯码" @keyup.enter="lookup" />
            <el-button class="mt-12" @click="lookup">查询空瓶</el-button>
          </el-form-item>
          <template v-if="bottle">
            <el-form-item label="化学品">
              <div>{{ bottle.chemical.name }} · <span class="muted">{{ bottle.chemical.casNo }}</span></div>
            </el-form-item>
            <el-form-item label="危化等级">
              <span class="tag-hazard" :class="`h-${bottle.chemical.hazardClass}`">{{ hazardLabel(bottle.chemical.hazardClass) }}</span>
            </el-form-item>
            <el-form-item label="当前状态">
              <span class="status-tag" :class="`status-${bottle.status}`">{{ statusLabel(bottle.status) }}</span>
            </el-form-item>
            <el-form-item label="操作类型">
              <el-radio-group v-model="form.opType">
                <el-radio value="WASHED">清洗入库</el-radio>
                <el-radio value="DESTROYED">销毁</el-radio>
                <el-radio value="RETURN_TO_VENDOR">厂家回收</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="空瓶重量"><el-input-number v-model="form.weight" :min="0" :precision="2" /> g</el-form-item>
            <el-form-item label="备注"><el-input v-model="form.note" /></el-form-item>
            <el-button type="primary" @click="submit" style="width:100%;">登记</el-button>
            <div class="muted mt-12" v-if="bottle.status !== 'DEPLETED' && bottle.status !== 'IN_USE'">提示：未使用完毕的空瓶需先完成"使用登记"才能进入回收流程</div>
          </template>
        </el-form>
      </div>

      <div class="glass" style="padding:18px;">
        <h3 class="panel-title"><span class="bar"></span>清洗入库要求</h3>
        <div style="line-height:1.9; color:var(--ink-1);">
          <p>· 未清洗空瓶无法进入普通库房，必须先完成清洗登记。</p>
          <p>· 剧毒 / 易制爆 / 易制毒空瓶在清洗后仍需按危化品存储。</p>
          <p>· 厂家回收需上传双方签字的交接单，销毁需留照片证据。</p>
        </div>
        <h3 class="panel-title mt-12"><span class="bar"></span>近期操作</h3>
        <el-table :data="ops" size="small" max-height="380">
          <el-table-column label="时间" width="170">
            <template #default="{ row }">{{ new Date(row.operatedAt).toLocaleString("zh-CN") }}</template>
          </el-table-column>
          <el-table-column label="追溯码" prop="bottle.traceCode" width="200" />
          <el-table-column label="操作" width="100">
            <template #default="{ row }">
              <el-tag :type="opType(row.opType).type">{{ opType(row.opType).label }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作人" prop="operator.fullName" />
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "../utils/http";

const traceCode = ref("");
const bottle = ref<any>(null);
const ops = ref<any[]>([]);
const form = ref<any>({ opType: "WASHED", weight: 0, note: "" });

const HAZARD: Record<string, string> = { PRECURSOR_DRUG: "易制毒", EXPLOSIVE_PRECURSOR: "易制爆", HIGHLY_TOXIC: "剧毒", CORROSIVE: "腐蚀", FLAMMABLE: "易燃", OXIDIZER: "氧化", REACTIVE: "高活性", GENERAL: "常规" };
const hazardLabel = (s: string) => HAZARD[s] || s;
const STATUS: Record<string, string> = { IN_STORAGE: "在库", RESERVED: "已预留", IN_USE: "在用", DEPLETED: "耗尽", RECYCLING: "回收中", DESTROYED: "已销毁" };
const statusLabel = (s: string) => STATUS[s] || s;
const OP: Record<string, { label: string; type: any }> = { WASHED: { label: "清洗入库", type: "success" }, DESTROYED: { label: "销毁", type: "danger" }, RETURN_TO_VENDOR: { label: "厂家回收", type: "warning" } };
const opType = (s: string) => OP[s] || { label: s, type: "info" };

async function lookup() {
  try {
    const res: any = await http.get(`/bottles/scan/${encodeURIComponent(traceCode.value)}`);
    bottle.value = res.data;
    const opsRes: any = await http.get(`/empty-bottles/bottle/${res.data.id}`);
    ops.value = opsRes.data;
  } catch {
    bottle.value = null;
  }
}

async function submit() {
  await http.post("/empty-bottles", { ...form.value, bottleId: bottle.value.id });
  ElMessage.success("空瓶操作已登记");
  lookup();
}

onMounted(async () => {
  // 加载近期空瓶操作（从所有 DEPLETED 瓶推断）
});
</script>
