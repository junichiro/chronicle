---
author: junichiro
pubDatetime: 2025-12-27T09:00:00+09:00
modDatetime: 2025-12-28T10:00:00+09:00
title: Chronicle へようこそ - デザイン確認ページ
slug: welcome
featured: false
draft: false
tags:
  - welcome
  - design
description: Chronicle ブログのデザイン確認ページ。Markdown、コードブロック、MathJax 数式など各種要素の表示を確認できます。
---

このページは Chronicle ブログの各種デザイン要素を確認するためのページです。

## Table of contents

## 基本的な Markdown 要素

### テキストスタイル

通常のテキストに加えて、**太字**、*イタリック*、~~取り消し線~~、`インラインコード` が使えます。

> 引用ブロックはこのように表示されます。
> 複数行にまたがることもできます。

### リスト

順序なしリスト：

- 項目1
- 項目2
  - ネストした項目
  - もう一つのネスト
- 項目3

順序付きリスト：

1. 最初の項目
2. 次の項目
3. 最後の項目

### リンクと画像

[外部リンクの例](https://astro.build/)

### テーブル

| 機能 | 対応状況 | 備考 |
|------|----------|------|
| ダークモード | ✅ | 自動切り替え |
| MathJax | ✅ | 数式表示 |
| シンタックスハイライト | ✅ | 多言語対応 |

---

## コードブロック

### Python

```python
def fibonacci(n: int) -> int:
    """フィボナッチ数列のn番目を返す"""
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

# 使用例
for i in range(10):
    print(f"F({i}) = {fibonacci(i)}")
```

### TypeScript

```typescript
interface User {
  id: number;
  name: string;
  email: string;
}

async function fetchUser(id: number): Promise<User> {
  const response = await fetch(`/api/users/${id}`);
  if (!response.ok) {
    throw new Error("Failed to fetch user");
  }
  return response.json();
}
```

### Rust

```rust
fn main() {
    let numbers: Vec<i32> = (1..=10).collect();
    let sum: i32 = numbers.iter().sum();
    println!("Sum: {}", sum);
}
```

### シェルスクリプト

```bash
#!/bin/bash
echo "Hello, Chronicle!"
for i in {1..5}; do
    echo "Count: $i"
done
```

---

## MathJax 数式

### インライン数式

文中に数式を埋め込むことができます。例えば、アインシュタインの有名な式 $E = mc^2$ や、二次方程式の解の公式 $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$ などです。

円周率 $\pi$ は約 $3.14159$ であり、自然対数の底 $e$ は約 $2.71828$ です。

### 基本的なブロック数式

オイラーの等式（数学で最も美しい式と言われる）：

$$
e^{i\pi} + 1 = 0
$$

ピタゴラスの定理：

$$
a^2 + b^2 = c^2
$$

### 分数と根号

二次方程式の解の公式：

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$

連分数：

$$
\phi = 1 + \cfrac{1}{1 + \cfrac{1}{1 + \cfrac{1}{1 + \cdots}}}
$$

### 総和と積分

等差数列の和：

$$
\sum_{k=1}^{n} k = \frac{n(n+1)}{2}
$$

ガウス積分：

$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$

定積分の例：

$$
\int_{0}^{1} x^2 dx = \frac{1}{3}
$$

### 極限

$$
\lim_{n \to \infty} \left(1 + \frac{1}{n}\right)^n = e
$$

$$
\lim_{x \to 0} \frac{\sin x}{x} = 1
$$

### 行列

2×2 行列：

$$
A = \begin{pmatrix}
a & b \\
c & d
\end{pmatrix}
$$

3×3 行列：

$$
B = \begin{bmatrix}
1 & 2 & 3 \\
4 & 5 & 6 \\
7 & 8 & 9
\end{bmatrix}
$$

行列式：

$$
\det(A) = \begin{vmatrix}
a & b \\
c & d
\end{vmatrix} = ad - bc
$$

### 連立方程式

$$
\begin{cases}
x + y = 5 \\
2x - y = 1
\end{cases}
$$

### ギリシャ文字と記号

$$
\alpha, \beta, \gamma, \delta, \epsilon, \zeta, \eta, \theta, \iota, \kappa, \lambda, \mu
$$

$$
\nu, \xi, \pi, \rho, \sigma, \tau, \upsilon, \phi, \chi, \psi, \omega
$$

$$
\Gamma, \Delta, \Theta, \Lambda, \Xi, \Pi, \Sigma, \Phi, \Psi, \Omega
$$

### 物理学の方程式

シュレディンガー方程式：

$$
i\hbar\frac{\partial}{\partial t}\Psi(\mathbf{r},t) = \hat{H}\Psi(\mathbf{r},t)
$$

マクスウェル方程式（ガウスの法則）：

$$
\nabla \cdot \mathbf{E} = \frac{\rho}{\varepsilon_0}
$$

アインシュタインの場の方程式：

$$
R_{\mu\nu} - \frac{1}{2}Rg_{\mu\nu} + \Lambda g_{\mu\nu} = \frac{8\pi G}{c^4}T_{\mu\nu}
$$

### 数論

オイラーの等式（素数との関係）：

$$
\sum_{n=1}^{\infty} \frac{1}{n^s} = \prod_{p \text{ prime}} \frac{1}{1-p^{-s}}
$$

フィボナッチ数列の一般項：

$$
F_n = \frac{\phi^n - \psi^n}{\sqrt{5}}
$$

ここで $\phi = \frac{1 + \sqrt{5}}{2}$（黄金比）、$\psi = \frac{1 - \sqrt{5}}{2}$ です。

### 複雑な数式

スターリングの近似：

$$
n! \approx \sqrt{2\pi n}\left(\frac{n}{e}\right)^n
$$

フーリエ変換：

$$
\hat{f}(\xi) = \int_{-\infty}^{\infty} f(x) e^{-2\pi i x \xi} dx
$$

ガンマ関数：

$$
\Gamma(z) = \int_{0}^{\infty} t^{z-1} e^{-t} dt
$$

---

## まとめ

このページでは Chronicle ブログで使用できる各種デザイン要素を確認できます：

- **Markdown**: テキスト装飾、リスト、テーブル、引用など
- **コードブロック**: シンタックスハイライト付きの多言語対応
- **MathJax**: インライン数式からブロック数式まで幅広くサポート

デザイン変更時にはこのページで表示を確認してください。
