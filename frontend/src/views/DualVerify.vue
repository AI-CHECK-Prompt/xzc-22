<template>
  <div class="page">
    <div class="row-2-equal">
      <div class="glass" style="padding:18px;">
        <h3 class="panel-title"><span class="bar"></span>发起双人核验</h3>
        <el-form :model="form" label-width="100px">
          <el-form-item label="领用申请">
            <el-select v-model="form.requisitionId" filterable style="width:100%;">
              <el-option v-for="r in candidates" :key="r.id" :value="r.id" :label="`${r.reqNo} · ${r.applicant.fullName}`" />
            </el-select>
          </el-form-item>
          <el-form-item label="同伴核验人">
            <el-select v-model="form.userBId" filterable style="width:100%;">
              <el-option v-for="u in users" :key="u.id" :value="u.id" :label="`${u.fullName} (${u.username})`" />
            </el-select>
          </el-form-item>
          <el-form-item label="现场定位">
            <div style="display:flex; gap:8px; width:100%;">
              <el-input v-model="form.locationDesc" placeholder="例如：A101 危化品暂存柜" />
              <el-button @click="locate">获取定位</el-button>
            </div>
            <div class="muted mt-12" v-if="form.locationLat">已获取：{{ form.locationLat.toFixed(4) }}, {{ form.locationLng?.toFixed(4) }}</div>
          </el-form-item>
          <el-form-item label="录像存证">
            <el-input v-model="form.videoUrl" placeholder="录像 URL（可选，由前端采集后回填）" />
          </el-form-item>
          <el-button type="primary" @click="submit" :disabled="!form.requisitionId || !form.userBId" style="width:100%;">提交核验，开启电子锁</el-button>
        </el-form>
      </div>

      <div class="glass" style="padding:18px;">
        <h3 class="panel-title"><span class="bar"></span>核验记录</h3>
        <el-table :data="rows" size="small" max-height="520">
          <el-table-column label="时间" width="150">
            <template #default="{ row }">{{ new Date(row.checkInAt).toLocaleString("zh-CN") }}</template>
          </el-table-column>
          <el-table-column label="领用单" prop="requisition.reqNo" width="170" />
          <el-table-column label="A" prop="userA.fullName" width="80" />
          <el-table-column label="B" prop="userB.fullName" width="80" />
          <el-table-column label="结果" width="80">
            <template #default="{ row }">
              <el-tag :type="row.result === 'PASS' ? 'success' : 'danger'" size="small">{{ row.result }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="位置" prop="locationDesc" />
          <el-table-column label="操作" width="120">
            <template #default="{ row }">
              <el-button v-if="!row.cabinetClosedAt" size="small" type="primary" link @click="close(row)">关闭锁具</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from "vue";
import { ElMessage } from "element-plus";
import { http } from "../utils/http";

const form = ref<any>({ requisitionId: "", userBId: "", locationDesc: "", locationLat: null, locationLng: null, videoUrl: "" });
const rows = ref<any[]>([]);
const reqs = ref<any[]>([]);
const users = ref<any[]>([]);

const candidates = computed(() => reqs.value.filter((r) => r.status === "APPROVED" || r.status === "VERIFYING"));

async function load() {
  const [r1, r2, r3] = await Promise.all([http.get("/requisitions"), http.get("/users"), http.get("/dual-verifications")]);
  reqs.value = (r1 as any).data;
  users.value = (r2 as any).data;
  rows.value = (r3 as any).data;
}

function locate() {
  if (!navigator.geolocation) return ElMessage.warning("浏览器不支持定位");
  navigator.geolocation.getCurrentPosition(
    (p) => {
      form.value.locationLat = p.coords.latitude;
      form.value.locationLng = p.coords.longitude;
      form.value.locationDesc = form.value.locationDesc || `现场定位 (${p.coords.latitude.toFixed(4)}, ${p.coords.longitude.toFixed(4)})`;
      ElMessage.success("定位已记录");
    },
    () => ElMessage.warning("定位失败，请手动填写"),
    { timeout: 5000 },
  );
}

async function submit() {
  await http.post("/dual-verifications", form.value);
  ElMessage.success("核验通过，电子锁已开启");
  form.value = { requisitionId: "", userBId: "", locationDesc: "", locationLat: null, locationLng: null, videoUrl: "" };
  load();
}

async function close(row: any) {
  await http.post(`/dual-verifications/${row.id}/close`);
  ElMessage.success("锁具已关闭，领用完成");
  load();
}

onMounted(load);
</script>
