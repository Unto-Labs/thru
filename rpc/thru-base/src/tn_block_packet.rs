use log::info;

pub const MESSAGE_TYPE_BLOCK_PACKET: u64 = 0xBB;
pub const BLOCK_PACKET_HAS_HEADER: u8 = 0x01;
pub const BLOCK_PACKET_HAS_FOOTER: u8 = 0x02;
pub const BLOCK_PACKET_VERSION_V1: u8 = 0x01;

#[repr(C, packed)]
pub struct TnBlockPacket {
    pub block_header_sig: [u8; 64],
    pub block_packet_version: u8,
    pub flags: u8,
    pub offset: u32,
    //pub payload: [u8],
}

impl TnBlockPacket {
    pub fn log_packet_info(&self) {
        let has_header = (self.flags & BLOCK_PACKET_HAS_HEADER) != 0;
        let has_footer = (self.flags & BLOCK_PACKET_HAS_FOOTER) != 0;
        let offset = self.offset;
        let first_sig_u64 = u64::from_le_bytes(self.block_header_sig[0..8].try_into().unwrap());

        info!(
            "TnBlockPacket - version: {}, flags: 0x{:02x} (header: {}, footer: {}), offset: {}, first_sig_u64: {}",
            self.block_packet_version, self.flags, has_header, has_footer, offset, first_sig_u64
        );
    }
}
