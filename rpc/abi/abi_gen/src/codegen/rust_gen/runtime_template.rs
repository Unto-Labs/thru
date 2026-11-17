/* Generated ABI runtime module - DO NOT EDIT */
/* Shared by every generated package: views, validators, parameter extraction
   and builders all go through these helpers. Everything here is `core`-only so
   generated code works in `#![no_std]` crates. */
#![allow(dead_code, clippy::all)]

/* ============================================================================
 * Errors
 * ============================================================================ */

/// Error returned by generated validators, views and builders.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AbiError {
    /// The buffer ends before the layout does. `needed` is the full encoded
    /// size when the bytes present determine it (every length/tag field the
    /// layout reads, and the start of every jagged element, lies inside them,
    /// and no size-discriminated union or `__buffer_size` is reached),
    /// otherwise a lower bound (the bytes needed to read the next length or
    /// tag field); `have` is the buffer length.
    BufferTooSmall { needed: usize, have: usize },
    /// An enum tag does not match any declared variant.
    InvalidVariant,
    /// A required dynamic parameter was not provided.
    MissingParam,
    /// An IR switch had no case for the tag value.
    MissingSwitchCase,
    /// An IR call referenced a type with no generated helpers.
    UnknownNestedType,
    /// Size or offset arithmetic overflowed.
    ArithmeticOverflow,
    /// An access fell outside the buffer.
    OutOfBounds,
    /// An access was not suitably aligned.
    Misaligned,
    /// No size-discriminated union variant matches the available bytes.
    InvalidSize,
    /// A value or payload had the wrong length.
    LengthMismatch,
    /// A size expression divided by zero.
    DivisionByZero,
    /// The operation is not available for this layout.
    Unsupported,
}

/// Compatibility name used by the IR helper functions.
pub type AbiIrValidateError = AbiError;

impl AbiError {
    pub const fn as_str(self) -> &'static str {
        match self {
            AbiError::BufferTooSmall { .. } => "buffer too small",
            AbiError::InvalidVariant => "invalid variant tag",
            AbiError::MissingParam => "missing parameter",
            AbiError::MissingSwitchCase => "missing switch case",
            AbiError::UnknownNestedType => "unknown nested type",
            AbiError::ArithmeticOverflow => "size arithmetic overflow",
            AbiError::OutOfBounds => "out of bounds access",
            AbiError::Misaligned => "misaligned access",
            AbiError::InvalidSize => "no variant matches the payload size",
            AbiError::LengthMismatch => "length mismatch",
            AbiError::DivisionByZero => "division by zero in size expression",
            AbiError::Unsupported => "operation not supported for this layout",
        }
    }
}

impl AbiError {
    /// Bytes required when the buffer was too small (see `BufferTooSmall`).
    pub const fn required_size(self) -> Option<usize> {
        match self {
            AbiError::BufferTooSmall { needed, .. } => Some(needed),
            _ => None,
        }
    }

    /// Re-express a size error reported for `buf[base..]` relative to `buf`.
    #[inline]
    pub const fn shifted(self, base: usize) -> Self {
        match self {
            AbiError::BufferTooSmall { needed, have } => AbiError::BufferTooSmall {
                needed: needed.saturating_add(base),
                have: have.saturating_add(base),
            },
            other => other,
        }
    }
}

/// `BufferTooSmall` for a buffer of `have` bytes that needs `needed`.
#[inline]
pub const fn tn_short(needed: usize, have: usize) -> AbiError {
    AbiError::BufferTooSmall { needed, have }
}

impl core::fmt::Display for AbiError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            AbiError::BufferTooSmall { needed, have } => {
                write!(f, "buffer too small: need {} bytes, have {}", needed, have)
            }
            other => f.write_str(other.as_str()),
        }
    }
}

impl core::error::Error for AbiError {}

impl From<AbiError> for &'static str {
    fn from(err: AbiError) -> Self {
        err.as_str()
    }
}

pub fn abi_ir_error_str(err: AbiError) -> &'static str {
    err.as_str()
}

/// Panic used by view accessors when the underlying bytes no longer form a
/// valid layout (for example after a mutable view changed a length field).
#[cold]
#[inline(never)]
#[track_caller]
pub fn tn_invalid(err: AbiError) -> ! {
    panic!("invalid ABI buffer: {}", err.as_str())
}

#[inline]
#[track_caller]
pub fn tn_expect<T>(r: Result<T, AbiError>) -> T {
    match r {
        Ok(v) => v,
        Err(e) => tn_invalid(e),
    }
}

/// Panic used by the panicking builder setters (`set_*`) when their input is
/// rejected; the matching `try_set_*` returns the error instead.
#[cold]
#[inline(never)]
#[track_caller]
pub fn tn_builder_misuse(err: AbiError) -> ! {
    panic!("invalid builder input: {}", err)
}

/// Panic used by the panicking view setters (`set_<f>(values)` with the
/// wrong element count); the matching `try_set_<f>` returns the error instead.
#[cold]
#[inline(never)]
#[track_caller]
pub fn tn_view_misuse(err: AbiError) -> ! {
    panic!("invalid view input: {}", err)
}

/// Panic used by indexed accessors, mirroring slice indexing; every one has
/// a `try_` twin returning `Option` / `Result` instead.
#[cold]
#[inline(never)]
#[track_caller]
pub fn tn_out_of_range(index: usize, len: usize) -> ! {
    panic!("index out of range: the len is {} but the index is {}", len, index)
}

/* ============================================================================
 * Variant metadata
 * ============================================================================ */

/// Static description of one variant of an enum, size-discriminated union or
/// union (generated as `<FIELD>_VARIANTS` / `VARIANTS` tables).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VariantInfo {
    /// Variant name as written in the ABI.
    pub name: &'static str,
    /// Enum tag value; the declaration index for size-discriminated unions and
    /// unions.
    pub tag: u64,
    /// Encoded payload size when it is constant (the selecting size for
    /// size-discriminated unions).
    pub payload_size: Option<usize>,
    /// ABI name of the payload type.
    pub payload_type: &'static str,
}

/// Find a variant by ABI name.
pub fn tn_variant_by_name(
    table: &'static [VariantInfo],
    name: &str,
) -> Option<&'static VariantInfo> {
    table.iter().find(|v| v.name == name)
}

/// Find a variant by tag.
pub fn tn_variant_by_tag(table: &'static [VariantInfo], tag: u64) -> Option<&'static VariantInfo> {
    table.iter().find(|v| v.tag == tag)
}

/// Check `payload` against a variant's constant size, if it has one.
#[inline]
pub fn tn_check_payload(info: &VariantInfo, payload: &[u8]) -> Result<(), AbiError> {
    match info.payload_size {
        Some(n) if n != payload.len() => Err(AbiError::LengthMismatch),
        _ => Ok(()),
    }
}

/// Look up a parameter value by Rust field name or ABI path in a
/// `(field, path)` key table and the matching values.
pub fn tn_param_index(keys: &[(&'static str, &'static str)], key: &str) -> Option<usize> {
    keys.iter().position(|(field, path)| *field == key || *path == key)
}

/* ============================================================================
 * Checked arithmetic
 * ============================================================================ */

pub fn tn_checked_add_u64(a: u64, b: u64) -> Result<u64, AbiError> {
    a.checked_add(b).ok_or(AbiError::ArithmeticOverflow)
}

pub fn tn_checked_sub_u64(a: u64, b: u64) -> Result<u64, AbiError> {
    a.checked_sub(b).ok_or(AbiError::ArithmeticOverflow)
}

pub fn tn_checked_mul_u64(a: u64, b: u64) -> Result<u64, AbiError> {
    a.checked_mul(b).ok_or(AbiError::ArithmeticOverflow)
}

#[inline]
pub fn tn_add(a: usize, b: usize) -> Result<usize, AbiError> {
    a.checked_add(b).ok_or(AbiError::ArithmeticOverflow)
}

#[inline]
pub fn tn_mul(a: usize, b: usize) -> Result<usize, AbiError> {
    a.checked_mul(b).ok_or(AbiError::ArithmeticOverflow)
}

/// Round `off` up to a multiple of `align` (any non-zero alignment).
#[inline]
pub fn tn_align(off: usize, align: usize) -> Result<usize, AbiError> {
    if align <= 1 {
        return Ok(off);
    }
    let rem = off % align;
    if rem == 0 {
        Ok(off)
    } else {
        tn_add(off, align - rem)
    }
}

/// Round `v` up to a multiple of `align` in 64-bit IR arithmetic.
#[inline]
pub fn tn_align_u64(v: u64, align: u64) -> Result<u64, AbiError> {
    if align <= 1 {
        return Ok(v);
    }
    let rem = v % align;
    if rem == 0 {
        Ok(v)
    } else {
        v.checked_add(align - rem).ok_or(AbiError::ArithmeticOverflow)
    }
}

/// Convert an evaluated size expression to `usize`.
#[inline]
pub fn tn_usize(v: u64) -> Result<usize, AbiError> {
    usize::try_from(v).map_err(|_| AbiError::ArithmeticOverflow)
}

/* Size-expression operators: unsigned 64-bit, every overflow is an error. */
#[inline]
pub fn tn_e_add(a: u64, b: u64) -> Result<u64, AbiError> {
    a.checked_add(b).ok_or(AbiError::ArithmeticOverflow)
}
#[inline]
pub fn tn_e_sub(a: u64, b: u64) -> Result<u64, AbiError> {
    a.checked_sub(b).ok_or(AbiError::ArithmeticOverflow)
}
#[inline]
pub fn tn_e_mul(a: u64, b: u64) -> Result<u64, AbiError> {
    a.checked_mul(b).ok_or(AbiError::ArithmeticOverflow)
}
#[inline]
pub fn tn_e_div(a: u64, b: u64) -> Result<u64, AbiError> {
    a.checked_div(b).ok_or(AbiError::DivisionByZero)
}
#[inline]
pub fn tn_e_mod(a: u64, b: u64) -> Result<u64, AbiError> {
    a.checked_rem(b).ok_or(AbiError::DivisionByZero)
}
#[inline]
pub fn tn_e_pow(a: u64, b: u64) -> Result<u64, AbiError> {
    /* Exact over the full u64 exponent: a^0 = 1, 0^b = 0 and 1^b = 1 for any
       b > 0; any other base overflows once b reaches 64. */
    if b == 0 || a == 1 {
        return Ok(1);
    }
    if a == 0 {
        return Ok(0);
    }
    if b >= 64 {
        return Err(AbiError::ArithmeticOverflow);
    }
    a.checked_pow(b as u32).ok_or(AbiError::ArithmeticOverflow)
}
#[inline]
pub fn tn_e_shl(a: u64, b: u64) -> Result<u64, AbiError> {
    if b >= 64 {
        return if a == 0 { Ok(0) } else { Err(AbiError::ArithmeticOverflow) };
    }
    let r = a << b;
    if (r >> b) != a {
        return Err(AbiError::ArithmeticOverflow);
    }
    Ok(r)
}
/// Checked negation: `-a` is representable only for `a == 0`.
#[inline]
pub fn tn_e_neg(a: u64) -> Result<u64, AbiError> {
    if a == 0 { Ok(0) } else { Err(AbiError::ArithmeticOverflow) }
}
#[inline]
pub fn tn_e_shr(a: u64, b: u64) -> u64 {
    if b >= 64 { 0 } else { a >> b }
}

/// Sign-extend the low `n` bytes of `raw` to 64 bits.
#[inline]
pub fn tn_sext(raw: u64, n: usize) -> u64 {
    if n >= 8 || n == 0 {
        return raw;
    }
    let shift = 64 - 8 * n as u32;
    (((raw << shift) as i64) >> shift) as u64
}

/* ============================================================================
 * Byte sources used by generated layout walkers
 * ============================================================================ */

/// Read access to a (possibly virtual) byte buffer.
pub trait TnBuf {
    fn tn_len(&self) -> usize;
    /// Read `n` (0..=8) little-endian bytes at `off`.
    fn tn_get(&self, off: usize, n: usize) -> Result<u64, AbiError>;
    /// Byte count seen by length-dependent layouts (`__buffer_size`,
    /// size-discriminated unions). A measuring buffer has none.
    #[inline]
    fn tn_avail(&self) -> Result<usize, AbiError> {
        Ok(self.tn_len())
    }
    /// Bytes actually present (only a measuring buffer differs from `tn_len`).
    #[inline]
    fn tn_present(&self) -> usize {
        self.tn_len()
    }
    /// True for [`TnMeasure`] and windows into it.
    #[inline]
    fn tn_measuring(&self) -> bool {
        false
    }
}

/// Write access to a (possibly virtual) byte buffer.
pub trait TnBufMut: TnBuf {
    fn tn_zero(&mut self, off: usize, n: usize) -> Result<(), AbiError>;
    /// Write the low `n` (0..=8) bytes of `v` little-endian at `off`.
    fn tn_put(&mut self, off: usize, n: usize, v: u64) -> Result<(), AbiError>;
}

#[inline]
fn tn_range(len: usize, off: usize, n: usize) -> Result<usize, AbiError> {
    let end = off.checked_add(n).ok_or(AbiError::OutOfBounds)?;
    if end > len {
        return Err(tn_short(end, len));
    }
    Ok(end)
}

impl TnBuf for [u8] {
    #[inline]
    fn tn_len(&self) -> usize {
        self.len()
    }
    #[inline]
    fn tn_get(&self, off: usize, n: usize) -> Result<u64, AbiError> {
        let end = tn_range(self.len(), off, n)?;
        let mut v = 0u64;
        for (i, b) in self[off..end].iter().enumerate() {
            v |= (*b as u64) << (8 * i);
        }
        Ok(v)
    }
}

impl TnBufMut for [u8] {
    #[inline]
    fn tn_zero(&mut self, off: usize, n: usize) -> Result<(), AbiError> {
        let end = tn_range(self.len(), off, n)?;
        self[off..end].fill(0);
        Ok(())
    }
    #[inline]
    fn tn_put(&mut self, off: usize, n: usize, v: u64) -> Result<(), AbiError> {
        let end = tn_range(self.len(), off, n)?;
        self[off..end].copy_from_slice(&v.to_le_bytes()[..n]);
        Ok(())
    }
}

/// Read-only window starting `base` bytes into another byte source.
pub struct TnSub<'b, D: ?Sized> {
    inner: &'b D,
    base: usize,
}

impl<'b, D: TnBuf + ?Sized> TnSub<'b, D> {
    #[inline]
    pub fn new(inner: &'b D, base: usize) -> Result<Self, AbiError> {
        if base > inner.tn_len() {
            return Err(tn_short(base, inner.tn_len()));
        }
        Ok(Self { inner, base })
    }
}

impl<D: TnBuf + ?Sized> TnBuf for TnSub<'_, D> {
    #[inline]
    fn tn_len(&self) -> usize {
        self.inner.tn_len() - self.base
    }
    #[inline]
    fn tn_get(&self, off: usize, n: usize) -> Result<u64, AbiError> {
        tn_range(self.tn_len(), off, n)?;
        self.inner.tn_get(self.base + off, n)
    }
    #[inline]
    fn tn_avail(&self) -> Result<usize, AbiError> {
        Ok(self.inner.tn_avail()?.saturating_sub(self.base))
    }
    #[inline]
    fn tn_present(&self) -> usize {
        self.inner.tn_present().saturating_sub(self.base)
    }
    #[inline]
    fn tn_measuring(&self) -> bool {
        self.inner.tn_measuring()
    }
}

/// Run a nested walker over `data[base..]`; size errors it reports (relative
/// to the window) are re-expressed relative to `data`.
#[inline]
pub fn tn_at<D: TnBuf + ?Sized, T>(
    data: &D,
    base: usize,
    f: impl FnOnce(&TnSub<'_, D>) -> Result<T, AbiError>,
) -> Result<T, AbiError> {
    let sub = TnSub::new(data, base)?;
    f(&sub).map_err(|e| e.shifted(base))
}

/// Mutable counterpart of [`tn_at`] (used by initializers).
#[inline]
pub fn tn_at_mut<D: TnBufMut + ?Sized, T>(
    data: &mut D,
    base: usize,
    f: impl FnOnce(&mut TnSubMut<'_, D>) -> Result<T, AbiError>,
) -> Result<T, AbiError> {
    let mut sub = TnSubMut::new(data, base)?;
    f(&mut sub).map_err(|e| e.shifted(base))
}

/// Writable window starting `base` bytes into another byte source.
pub struct TnSubMut<'b, D: ?Sized> {
    inner: &'b mut D,
    base: usize,
}

impl<'b, D: TnBufMut + ?Sized> TnSubMut<'b, D> {
    #[inline]
    pub fn new(inner: &'b mut D, base: usize) -> Result<Self, AbiError> {
        if base > inner.tn_len() {
            return Err(tn_short(base, inner.tn_len()));
        }
        Ok(Self { inner, base })
    }
}

impl<D: TnBufMut + ?Sized> TnBuf for TnSubMut<'_, D> {
    #[inline]
    fn tn_len(&self) -> usize {
        self.inner.tn_len() - self.base
    }
    #[inline]
    fn tn_get(&self, off: usize, n: usize) -> Result<u64, AbiError> {
        tn_range(self.tn_len(), off, n)?;
        self.inner.tn_get(self.base + off, n)
    }
    #[inline]
    fn tn_avail(&self) -> Result<usize, AbiError> {
        Ok(self.inner.tn_avail()?.saturating_sub(self.base))
    }
    #[inline]
    fn tn_present(&self) -> usize {
        self.inner.tn_present().saturating_sub(self.base)
    }
    #[inline]
    fn tn_measuring(&self) -> bool {
        self.inner.tn_measuring()
    }
}

impl<D: TnBufMut + ?Sized> TnBufMut for TnSubMut<'_, D> {
    #[inline]
    fn tn_zero(&mut self, off: usize, n: usize) -> Result<(), AbiError> {
        tn_range(self.tn_len(), off, n)?;
        self.inner.tn_zero(self.base + off, n)
    }
    #[inline]
    fn tn_put(&mut self, off: usize, n: usize, v: u64) -> Result<(), AbiError> {
        tn_range(self.tn_len(), off, n)?;
        self.inner.tn_put(self.base + off, n, v)
    }
}

/// A buffer with no storage: reads return zero except for bytes written with
/// `tn_put`. Running a type's initializer over it yields the footprint implied
/// by a set of dynamic parameters without allocating.
pub struct TnVirtual<const K: usize> {
    len: usize,
    offs: [usize; K],
    lens: [usize; K],
    vals: [u64; K],
    cnt: usize,
}

impl<const K: usize> TnVirtual<K> {
    pub fn new(len: usize) -> Self {
        Self {
            len,
            offs: [0; K],
            lens: [0; K],
            vals: [0; K],
            cnt: 0,
        }
    }
}

impl<const K: usize> TnBuf for TnVirtual<K> {
    fn tn_len(&self) -> usize {
        self.len
    }
    fn tn_get(&self, off: usize, n: usize) -> Result<u64, AbiError> {
        tn_range(self.len, off, n)?;
        let mut v = 0u64;
        for i in 0..n {
            let pos = off + i;
            let mut byte = 0u64;
            for w in (0..self.cnt).rev() {
                let start = self.offs[w];
                if pos >= start && pos < start + self.lens[w] {
                    byte = (self.vals[w] >> (8 * (pos - start))) & 0xff;
                    break;
                }
            }
            v |= byte << (8 * i);
        }
        Ok(v)
    }
}

impl<const K: usize> TnBufMut for TnVirtual<K> {
    fn tn_zero(&mut self, off: usize, n: usize) -> Result<(), AbiError> {
        tn_range(self.len, off, n)?;
        Ok(())
    }
    fn tn_put(&mut self, off: usize, n: usize, v: u64) -> Result<(), AbiError> {
        tn_range(self.len, off, n)?;
        if self.cnt == K {
            return Err(AbiError::Unsupported);
        }
        self.offs[self.cnt] = off;
        self.lens[self.cnt] = n;
        self.vals[self.cnt] = v;
        self.cnt += 1;
        Ok(())
    }
}

/// Short-buffer measuring source: a layout walk over it computes the size the
/// bytes present imply. It is unbounded (no end check fails), but every read
/// must lie inside the bytes present, length-dependent layouts have no size
/// (`tn_avail` fails) and jagged walkers stop at an element that starts past
/// the bytes present. Any error means the required size is not determined.
pub struct TnMeasure<'b> {
    data: &'b [u8],
}

impl<'b> TnMeasure<'b> {
    #[inline]
    pub fn new(data: &'b [u8]) -> Self {
        Self { data }
    }
}

impl TnBuf for TnMeasure<'_> {
    #[inline]
    fn tn_len(&self) -> usize {
        usize::MAX
    }
    #[inline]
    fn tn_get(&self, off: usize, n: usize) -> Result<u64, AbiError> {
        self.data.tn_get(off, n)
    }
    #[inline]
    fn tn_avail(&self) -> Result<usize, AbiError> {
        Err(AbiError::Unsupported)
    }
    #[inline]
    fn tn_present(&self) -> usize {
        self.data.len()
    }
    #[inline]
    fn tn_measuring(&self) -> bool {
        true
    }
}

/// Refine the size error `err` of a walk over `data`: when the bytes present
/// determine the value's size (`measure` over a [`TnMeasure`] succeeds) and it
/// exceeds `data`, report that exact size; otherwise keep `err`.
#[inline]
pub fn tn_measured(
    err: AbiError,
    data: &[u8],
    measure: impl FnOnce(&TnMeasure<'_>) -> Result<usize, AbiError>,
) -> AbiError {
    match err {
        AbiError::BufferTooSmall { .. } => match measure(&TnMeasure::new(data)) {
            Ok(end) if end > data.len() => tn_short(end, data.len()),
            _ => err,
        },
        other => other,
    }
}

/// Offsets (`off`), byte lengths (`len`) and per-field auxiliary values
/// (`aux`: element count for arrays, tag for enums, variant index for
/// size-discriminated unions) computed by a layout walk, plus the total size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TnLayout<const N: usize> {
    pub off: [usize; N],
    pub len: [usize; N],
    pub aux: [u64; N],
    pub end: usize,
}

impl<const N: usize> TnLayout<N> {
    #[inline]
    pub const fn new() -> Self {
        Self {
            off: [0; N],
            len: [0; N],
            aux: [0; N],
            end: 0,
        }
    }

    /// Borrow helper so generated code can treat values and references alike.
    #[inline]
    pub fn tn_ref(&self) -> &Self {
        self
    }
}

impl<const N: usize> Default for TnLayout<N> {
    fn default() -> Self {
        Self::new()
    }
}

/// `data[off..]`, or `BufferTooSmall`.
#[inline]
pub fn tn_tail(data: &[u8], off: usize) -> Result<&[u8], AbiError> {
    data.get(off..).ok_or(tn_short(off, data.len()))
}

/// `data[off..off + len]`, or `BufferTooSmall`.
#[inline]
pub fn tn_slice(data: &[u8], off: usize, len: usize) -> Result<&[u8], AbiError> {
    let end = off.checked_add(len).ok_or(AbiError::OutOfBounds)?;
    data.get(off..end).ok_or(tn_short(end, data.len()))
}

/// Mutable `data[off..off + len]`, or `BufferTooSmall`.
#[inline]
pub fn tn_slice_mut(data: &mut [u8], off: usize, len: usize) -> Result<&mut [u8], AbiError> {
    let end = off.checked_add(len).ok_or(AbiError::OutOfBounds)?;
    let have = data.len();
    data.get_mut(off..end).ok_or(tn_short(end, have))
}

/// Validate a nested value stored at `data[off..]`; size errors are reported
/// relative to `data`.
#[inline]
pub fn tn_validate_at(
    data: &[u8],
    off: usize,
    f: impl FnOnce(&[u8]) -> Result<usize, AbiError>,
) -> Result<usize, AbiError> {
    f(tn_tail(data, off)?).map_err(|e| e.shifted(off))
}

/* Accessor helpers: views are validated on construction, so these index
   directly (and panic like slice indexing if a mutable view broke its own
   layout). */
#[inline]
pub fn tn_rd(data: &[u8], off: usize, n: usize) -> u64 {
    let mut v = 0u64;
    for (i, b) in data[off..off + n].iter().enumerate() {
        v |= (*b as u64) << (8 * i);
    }
    v
}

#[inline]
pub fn tn_wr(data: &mut [u8], off: usize, n: usize, v: u64) {
    data[off..off + n].copy_from_slice(&v.to_le_bytes()[..n]);
}

/* ============================================================================
 * Legacy FAT pointer types (kept for existing callers)
 * ============================================================================ */

/// Immutable view into a byte buffer with bounds checking and endian-aware reads.
#[derive(Debug, Clone, Copy)]
pub struct TnView<'a> {
    buf: &'a [u8],
    offset: usize,
    len: usize,
}

impl<'a> TnView<'a> {
    pub fn new(buf: &'a [u8]) -> Self {
        Self { buf, offset: 0, len: buf.len() }
    }

    pub fn with_range(buf: &'a [u8], offset: usize, len: usize) -> Result<Self, AbiError> {
        tn_slice(buf, offset, len)?;
        Ok(Self { buf, offset, len })
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.len
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    #[inline]
    pub fn as_slice(&self) -> &'a [u8] {
        &self.buf[self.offset..self.offset + self.len]
    }

    pub fn slice(&self, rel_offset: usize, len: usize) -> Result<Self, AbiError> {
        let start = tn_add(self.offset, rel_offset)?;
        let end = tn_add(start, len)?;
        if end > self.offset + self.len {
            return Err(AbiError::OutOfBounds);
        }
        Ok(Self { buf: self.buf, offset: start, len })
    }

    pub fn read_u8(&self, rel_offset: usize) -> Result<u8, AbiError> {
        Ok(self.as_slice().tn_get(rel_offset, 1)? as u8)
    }
    pub fn read_u16_le(&self, rel_offset: usize) -> Result<u16, AbiError> {
        Ok(self.as_slice().tn_get(rel_offset, 2)? as u16)
    }
    pub fn read_u32_le(&self, rel_offset: usize) -> Result<u32, AbiError> {
        Ok(self.as_slice().tn_get(rel_offset, 4)? as u32)
    }
    pub fn read_u64_le(&self, rel_offset: usize) -> Result<u64, AbiError> {
        self.as_slice().tn_get(rel_offset, 8)
    }
}

/// Mutable view into a byte buffer with bounds checking and endian-aware writes.
#[derive(Debug)]
pub struct TnViewMut<'a> {
    buf: &'a mut [u8],
    offset: usize,
    len: usize,
}

impl<'a> TnViewMut<'a> {
    pub fn new(buf: &'a mut [u8]) -> Self {
        let len = buf.len();
        Self { buf, offset: 0, len }
    }

    pub fn write_u8(&mut self, rel_offset: usize, value: u8) -> Result<(), AbiError> {
        let off = tn_add(self.offset, rel_offset)?;
        tn_range(self.offset + self.len, off, 1)?;
        self.buf.tn_put(off, 1, value as u64)
    }
}

/// Registry entry for a type's footprint function.
pub type TnFootprintFn = fn(&[u64]) -> u64;

/// Registry entry for a type's validate function.
pub type TnValidateFn = fn(u64, &[u64]) -> Result<u64, AbiError>;
