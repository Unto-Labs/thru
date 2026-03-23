/* Lightweight FAT pointer views for zero-copy Rust codegen.
   These mirror the intent of TypeScript's DataView usage by pairing slices
   with bounds/offset helpers and little-endian primitive reads/writes. */

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TnViewError {
    OutOfBounds,
    Misaligned,
}

#[derive(Debug, Clone, Copy)]
pub struct TnView<'a> {
    buf: &'a [u8],
    offset: usize,
    len: usize,
}

impl<'a> TnView<'a> {
    pub fn new(buf: &'a [u8]) -> Self {
        Self {
            buf,
            offset: 0,
            len: buf.len(),
        }
    }

    pub fn with_range(buf: &'a [u8], offset: usize, len: usize) -> Result<Self, TnViewError> {
        if offset.checked_add(len).map_or(true, |end| end > buf.len()) {
            return Err(TnViewError::OutOfBounds);
        }
        Ok(Self { buf, offset, len })
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn slice(&self, rel_offset: usize, len: usize) -> Result<Self, TnViewError> {
        let start = self
            .offset
            .checked_add(rel_offset)
            .ok_or(TnViewError::OutOfBounds)?;
        let end = start
            .checked_add(len)
            .ok_or(TnViewError::OutOfBounds)?;
        if end > self.offset + self.len {
            return Err(TnViewError::OutOfBounds);
        }
        Ok(Self {
            buf: self.buf,
            offset: start,
            len,
        })
    }

    pub fn align_up_offset(&self, alignment: usize) -> Result<usize, TnViewError> {
        if alignment == 0 {
            return Err(TnViewError::Misaligned);
        }
        let align_minus_one = alignment - 1;
        let aligned = (self.offset + align_minus_one) & !align_minus_one;
        /* Check for overflow (aligned wrapped around) */
        if aligned < self.offset {
            return Err(TnViewError::OutOfBounds);
        }
        /* Check that aligned offset is still within the view bounds */
        let view_end = self.offset + self.len;
        if aligned > view_end {
            return Err(TnViewError::OutOfBounds);
        }
        Ok(aligned)
    }

    pub fn read_u16_le(&self, rel_offset: usize) -> Result<u16, TnViewError> {
        let view = self.slice(rel_offset, 2)?;
        Ok(u16::from_le_bytes([view.buf[view.offset], view.buf[view.offset + 1]]))
    }

    pub fn read_u32_le(&self, rel_offset: usize) -> Result<u32, TnViewError> {
        let view = self.slice(rel_offset, 4)?;
        Ok(u32::from_le_bytes([
            view.buf[view.offset],
            view.buf[view.offset + 1],
            view.buf[view.offset + 2],
            view.buf[view.offset + 3],
        ]))
    }

    pub fn read_u64_le(&self, rel_offset: usize) -> Result<u64, TnViewError> {
        let view = self.slice(rel_offset, 8)?;
        Ok(u64::from_le_bytes([
            view.buf[view.offset],
            view.buf[view.offset + 1],
            view.buf[view.offset + 2],
            view.buf[view.offset + 3],
            view.buf[view.offset + 4],
            view.buf[view.offset + 5],
            view.buf[view.offset + 6],
            view.buf[view.offset + 7],
        ]))
    }
}

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

    pub fn with_range(
        buf: &'a mut [u8],
        offset: usize,
        len: usize,
    ) -> Result<Self, TnViewError> {
        if offset.checked_add(len).map_or(true, |end| end > buf.len()) {
            return Err(TnViewError::OutOfBounds);
        }
        Ok(Self { buf, offset, len })
    }

    pub fn write_u16_le(&mut self, rel_offset: usize, value: u16) -> Result<(), TnViewError> {
        let bytes = value.to_le_bytes();
        let start = self.checked_start(rel_offset, 2)?;
        self.buf[start] = bytes[0];
        self.buf[start + 1] = bytes[1];
        Ok(())
    }

    pub fn write_u32_le(&mut self, rel_offset: usize, value: u32) -> Result<(), TnViewError> {
        let bytes = value.to_le_bytes();
        let start = self.checked_start(rel_offset, 4)?;
        self.buf[start..start + 4].copy_from_slice(&bytes);
        Ok(())
    }

    pub fn write_u64_le(&mut self, rel_offset: usize, value: u64) -> Result<(), TnViewError> {
        let bytes = value.to_le_bytes();
        let start = self.checked_start(rel_offset, 8)?;
        self.buf[start..start + 8].copy_from_slice(&bytes);
        Ok(())
    }

    fn checked_start(&self, rel_offset: usize, len: usize) -> Result<usize, TnViewError> {
        let start = self
            .offset
            .checked_add(rel_offset)
            .ok_or(TnViewError::OutOfBounds)?;
        let end = start
            .checked_add(len)
            .ok_or(TnViewError::OutOfBounds)?;
        if end > self.offset + self.len {
            return Err(TnViewError::OutOfBounds);
        }
        Ok(start)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tnview_slice_and_read() {
        let data = [1u8, 2, 3, 4, 5, 6, 7, 8];
        let view = TnView::new(&data);
        assert_eq!(view.read_u16_le(0).unwrap(), 0x0201);
        assert_eq!(view.read_u32_le(0).unwrap(), 0x04030201);
        assert_eq!(view.read_u64_le(0).unwrap(), 0x0807060504030201);
        assert!(view.slice(9, 1).is_err());
    }

    #[test]
    fn tnview_align_up() {
        let data = [0u8; 16];
        let view = TnView::with_range(&data, 3, 8).unwrap();
        assert_eq!(view.align_up_offset(4).unwrap(), 4);
        assert!(view.align_up_offset(0).is_err());
    }

    #[test]
    fn tnview_align_up_bounds_check() {
        /* Test case from bug report: offset=10, len=5 means view covers buf[10..15]
           Aligning to 8 would give aligned=16, which is outside the view bounds */
        let data = [0u8; 32];
        let view = TnView::with_range(&data, 10, 5).unwrap();
        /* View covers bytes 10-14. Align to 8 would give 16, which is out of bounds */
        assert!(view.align_up_offset(8).is_err());
        /* Align to 2 gives 10, which is within bounds */
        assert_eq!(view.align_up_offset(2).unwrap(), 10);
        /* Align to 4 gives 12, which is within bounds */
        assert_eq!(view.align_up_offset(4).unwrap(), 12);
    }

    #[test]
    fn tnviewmut_write_and_read() {
        let mut data = [0u8; 8];
        {
            let mut view = TnViewMut::new(&mut data);
            view.write_u16_le(0, 0xABCD).unwrap();
            view.write_u32_le(2, 0x01020304).unwrap();
            view.write_u64_le(0, 0x0102030405060708).unwrap();
        }
        let view_ro = TnView::new(&data);
        assert_eq!(view_ro.read_u64_le(0).unwrap(), 0x0102030405060708);
    }
}
