import React from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView } from "react-native";
import { colors } from "@/src/theme";

const PRESETS = ["0-0", "1-0", "0-1", "1-1", "2-0", "0-2", "2-1", "1-2", "2-2", "3-0", "0-3", "3-1", "1-3", "3-2", "2-3", "3-3", "4-0", "0-4"];

function clamp(n: string): string {
  const cleaned = n.replace(/[^0-9]/g, "");
  if (cleaned === "") return "";
  const num = Math.min(20, parseInt(cleaned, 10));
  return String(num);
}

export function ScoreInput({
  value,
  onChange,
  size = "md",
  testIDPrefix = "score",
  verticale = false,
}: {
  value: string;
  onChange: (v: string) => void;
  size?: "sm" | "md";
  testIDPrefix?: string;
  /** Casa sopra, ospite sotto, senza trattino (Schedina, 19/10/2026: accanto alle due squadre). */
  verticale?: boolean;
}) {
  const parts = (value || "").split("-");
  const home = parts[0] ?? "";
  const away = parts[1] ?? "";
  const compose = (h: string, a: string) => {
    if (h === "" && a === "") return "";
    return `${h || "0"}-${a || "0"}`;
  };
  return (
    <View>
      <View style={[styles.row, size === "sm" && styles.rowSm, verticale && styles.colonna]}>
        <TextInput
          testID={`${testIDPrefix}-home`}
          value={home}
          onChangeText={(t) => onChange(compose(clamp(t), away))}
          keyboardType="number-pad"
          maxLength={2}
          placeholder="0"
          placeholderTextColor={colors.textDim}
          style={[styles.box, size === "sm" && styles.boxSm]}
        />
        {verticale ? null : <Text style={[styles.dash, size === "sm" && styles.dashSm]}>—</Text>}
        <TextInput
          testID={`${testIDPrefix}-away`}
          value={away}
          onChangeText={(t) => onChange(compose(home, clamp(t)))}
          keyboardType="number-pad"
          maxLength={2}
          placeholder="0"
          placeholderTextColor={colors.textDim}
          style={[styles.box, size === "sm" && styles.boxSm]}
        />
      </View>
      {size === "md" && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.presetsRow}
        >
          {PRESETS.map((p) => (
            <TouchableOpacity
              key={p}
              testID={`${testIDPrefix}-preset-${p}`}
              onPress={() => onChange(p)}
              style={[styles.preset, value === p && styles.presetActive]}
            >
              <Text style={[styles.presetTxt, value === p && { color: "#FFF" }]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center" },
  rowSm: { gap: 4 },
  colonna: { flexDirection: "column", gap: 4 },
  box: {
    width: 64, height: 56, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceHi,
    color: colors.text, textAlign: "center", fontSize: 24, fontWeight: "900",
  },
  boxSm: { width: 38, height: 36, fontSize: 16, borderRadius: 8 },
  dash: { color: colors.textMuted, fontSize: 24, fontWeight: "900" },
  dashSm: { fontSize: 14 },
  presetsRow: { gap: 6, paddingVertical: 10 },
  preset: {
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: colors.surfaceHi, borderRadius: 8,
    borderWidth: 1, borderColor: colors.border,
  },
  presetActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  presetTxt: { color: colors.textMuted, fontWeight: "800", fontSize: 12 },
});
